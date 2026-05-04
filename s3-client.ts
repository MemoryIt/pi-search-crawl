/**
 * S3 客户端封装
 * 
 * 提供 S3 存储操作的封装，包括：
 * - 客户端创建
 * - 上传/下载文件
 * - 检查文件是否存在
 * - 列出指定前缀的文件
 */

import {
  S3Client,
  S3ClientConfig,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { S3Config } from "./config";
import { createWriteStream, createReadStream, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

/**
 * S3 操作结果
 */
export interface S3Result {
  success: boolean;
  error?: string;
}

/**
 * S3 文件信息
 */
export interface S3FileInfo {
  key: string;
  size?: number;
  lastModified?: Date;
}

/**
 * 创建 S3 客户端
 */
export function createS3Client(config: S3Config): S3Client {
  const clientConfig: S3ClientConfig = {
    endpoint: config.url,
    region: "auto",
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    // 强制使用路径样式访问（兼容 minio/tigris 等）
    forcePathStyle: true,
  };

  return new S3Client(clientConfig);
}

/**
 * 上传字符串内容到 S3
 */
export async function uploadContent(
  client: S3Client,
  bucket: string,
  key: string,
  content: string
): Promise<S3Result> {
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: getContentType(key),
    });
    await client.send(command);
    return { success: true };
  } catch (error) {
    return handleS3Error(error, `upload ${key}`);
  }
}

/**
 * 上传本地文件到 S3
 */
export async function uploadFile(
  client: S3Client,
  bucket: string,
  key: string,
  filePath: string
): Promise<S3Result> {
  try {
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const fileStat = statSync(filePath);
    const fileContent = readFileSync(filePath);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent,
      ContentType: getContentType(key),
      ContentLength: fileStat.size,
    });
    await client.send(command);
    return { success: true };
  } catch (error) {
    return handleS3Error(error, `upload file ${key}`);
  }
}

/**
 * 从 S3 下载文件内容（作为字符串）
 */
export async function downloadContent(
  client: S3Client,
  bucket: string,
  key: string
): Promise<{ success: true; content: string } | { success: false; error: string }> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await client.send(command);
    
    if (!response.Body) {
      return { success: false, error: "Empty response body" };
    }

    // 将流转换为字符串
    const chunks: Buffer[] = [];
    const body = response.Body as Readable;
    
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    
    const content = Buffer.concat(chunks).toString("utf-8");
    return { success: true, content };
  } catch (error) {
    const s3Error = error as S3ServiceException;
    if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
      return { success: false, error: `Key not found: ${key}` };
    }
    return { success: false, error: formatError(error) };
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (error) {
    const s3Error = error as S3ServiceException;
    if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // 其他错误也视为文件不存在
    return false;
  }
}

/**
 * 列出指定前缀的所有文件
 */
export async function listFiles(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<{ success: true; files: S3FileInfo[] } | { success: false; error: string }> {
  try {
    const files: S3FileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const response = await client.send(command);

      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key) {
            files.push({
              key: item.Key,
              size: item.Size,
              lastModified: item.LastModified,
            });
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return { success: true, files };
  } catch (error) {
    return { success: false, error: formatError(error) };
  }
}

/**
 * 下载文件到本地目录
 */
export async function downloadToDirectory(
  client: S3Client,
  bucket: string,
  key: string,
  localDir: string
): Promise<S3Result> {
  try {
    // 确保本地目录存在
    if (!existsSync(localDir)) {
      mkdirSync(localDir, { recursive: true });
    }

    // 获取文件名
    const fileName = key.split("/").pop() || key;
    const localPath = `${localDir}/${fileName}`;

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await client.send(command);

    if (!response.Body) {
      return { success: false, error: "Empty response body" };
    }

    const body = response.Body as Readable;
    const writeStream = createWriteStream(localPath);
    
    await pipeline(body, writeStream);
    
    return { success: true };
  } catch (error) {
    return handleS3Error(error, `download ${key}`);
  }
}

/**
 * 上传目录到 S3
 */
export async function uploadDirectory(
  client: S3Client,
  bucket: string,
  prefix: string,
  localDir: string,
  files: string[]
): Promise<{ success: true; uploaded: number } | { success: false; error: string }> {
  let uploaded = 0;

  for (const file of files) {
    const fileName = file.split("/").pop() || file;
    const key = `${prefix}/${fileName}`;
    
    const result = await uploadFile(client, bucket, key, file);
    if (result.success) {
      uploaded++;
    } else {
      return { success: false, error: result.error };
    }
  }

  return { success: true, uploaded };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 根据文件扩展名获取 Content-Type
 */
function getContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    md: "text/markdown",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    txt: "text/plain",
    css: "text/css",
    js: "application/javascript",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    xml: "application/xml",
    zip: "application/zip",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * 处理 S3 错误
 */
function handleS3Error(error: unknown, context: string): S3Result {
  const s3Error = error as S3ServiceException;
  
  if (s3Error.name === "NoSuchKey" || s3Error.$metadata?.httpStatusCode === 404) {
    return { success: false, error: `Key not found: ${context}` };
  }
  
  if (s3Error.name === "AccessDenied") {
    return { success: false, error: `Access denied: ${context}` };
  }
  
  if (s3Error.name === "NoSuchBucket") {
    return { success: false, error: `Bucket not found: ${context}` };
  }
  
  return { success: false, error: `S3 error: ${s3Error.message || formatError(error)}` };
}

/**
 * 格式化错误信息
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ============================================================
// Exports
// ============================================================

export default {
  createS3Client,
  uploadContent,
  uploadFile,
  downloadContent,
  fileExists,
  listFiles,
  downloadToDirectory,
  uploadDirectory,
};