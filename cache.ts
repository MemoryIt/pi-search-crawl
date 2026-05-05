/**
 * 缓存操作封装
 * 
 * 提供本地缓存和 S3 缓存的统一管理，包括：
 * - URL 哈希计算
 * - 本地缓存读写
 * - S3 缓存同步
 * - meta.json 管理
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { uploadContent, downloadContent, fileExists, listFiles } from "./s3-client";

/**
 * 缓存数据类型
 */
export interface CacheData {
  url: string;
  hash: string;
  raw?: string;
  clean?: string;
  summary?: string;
  meta: CacheMeta;
}

/**
 * 缓存元数据
 */
export interface CacheMeta {
  url: string;
  crawledAt: string;
  crawlMode: "raw" | "clean" | "summary";
  rawSize: number;
  cleanSize?: number;
  summarySize?: number;
}

/**
 * 缓存路径信息
 */
export interface CachePath {
  hash: string;
  dir: string;
  rawPath: string;
  cleanPath: string;
  summaryPath: string;
  metaPath: string;
}

/**
 * S3 缓存操作接口
 */
export interface S3CacheOperations {
  bucket: string;
  prefix: string;
  upload: (key: string, content: string) => Promise<boolean>;
  download: (key: string) => Promise<string | null>;
  exists: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<string[]>;
}

/**
 * 生成 URL 的哈希值（MD5）
 */
export function generateUrlHash(url: string): string {
  return createHash("md5").update(url).digest("hex");
}

/**
 * 获取缓存路径信息
 */
export function getCachePath(url: string, cacheDir: string): CachePath {
  const hash = generateUrlHash(url);
  const dir = join(cacheDir, hash);
  
  return {
    hash,
    dir,
    rawPath: join(dir, "raw.md"),
    cleanPath: join(dir, "clean.md"),
    summaryPath: join(dir, "summary.md"),
    metaPath: join(dir, "meta.json"),
  };
}

/**
 * 检查本地缓存是否存在
 */
export function hasLocalCache(url: string, cacheDir: string, mode?: "raw" | "clean" | "summary"): boolean {
  const paths = getCachePath(url, cacheDir);
  
  // 检查缓存目录是否存在
  if (!existsSync(paths.dir)) {
    return false;
  }
  
  // 检查所需的最小文件
  if (mode === undefined || mode === "raw") {
    return existsSync(paths.rawPath);
  }
  
  if (mode === "clean") {
    return existsSync(paths.rawPath) && existsSync(paths.cleanPath);
  }
  
  if (mode === "summary") {
    return existsSync(paths.rawPath) && existsSync(paths.cleanPath) && existsSync(paths.summaryPath);
  }
  
  return existsSync(paths.rawPath);
}

/**
 * 读取本地缓存
 */
export function getLocalCache(url: string, cacheDir: string): CacheData | null {
  const paths = getCachePath(url, cacheDir);
  
  // 检查缓存目录是否存在
  if (!existsSync(paths.dir)) {
    return null;
  }
  
  // 读取 meta.json
  if (!existsSync(paths.metaPath)) {
    return null;
  }
  
  try {
    const meta: CacheMeta = JSON.parse(readFileSync(paths.metaPath, "utf-8"));
    const result: CacheData = {
      url,
      hash: paths.hash,
      meta,
    };
    
    // 读取各级别的内容
    if (existsSync(paths.rawPath)) {
      result.raw = readFileSync(paths.rawPath, "utf-8");
    }
    if (existsSync(paths.cleanPath)) {
      result.clean = readFileSync(paths.cleanPath, "utf-8");
    }
    if (existsSync(paths.summaryPath)) {
      result.summary = readFileSync(paths.summaryPath, "utf-8");
    }
    
    return result;
  } catch (error) {
    console.warn(`Failed to read local cache for ${url}:`, error);
    return null;
  }
}

/**
 * 保存本地缓存
 */
export function saveLocalCache(
  url: string,
  cacheDir: string,
  data: {
    raw?: string;
    clean?: string;
    summary?: string;
  }
): CacheData {
  const paths = getCachePath(url, cacheDir);
  
  // 创建缓存目录
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true });
  }
  
  // 更新 meta
  let meta: CacheMeta;
  const metaPath = paths.metaPath;
  
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {
      meta = {
        url,
        crawledAt: new Date().toISOString(),
        crawlMode: "raw",
        rawSize: 0,
      };
    }
  } else {
    meta = {
      url,
      crawledAt: new Date().toISOString(),
      crawlMode: "raw",
      rawSize: 0,
    };
  }
  
  // 更新内容
  if (data.raw !== undefined) {
    writeFileSync(paths.rawPath, data.raw, "utf-8");
    meta.rawSize = data.raw.length;
    if (!meta.crawledAt) {
      meta.crawledAt = new Date().toISOString();
    }
  }
  
  if (data.clean !== undefined) {
    writeFileSync(paths.cleanPath, data.clean, "utf-8");
    meta.cleanSize = data.clean.length;
    meta.crawlMode = "clean";
  }
  
  if (data.summary !== undefined) {
    writeFileSync(paths.summaryPath, data.summary, "utf-8");
    meta.summarySize = data.summary.length;
    meta.crawlMode = "summary";
  }
  
  // 保存 meta.json
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  
  return {
    url,
    hash: paths.hash,
    raw: data.raw,
    clean: data.clean,
    summary: data.summary,
    meta,
  };
}

/**
 * 删除本地缓存
 */
export function deleteLocalCache(url: string, cacheDir: string): boolean {
  const paths = getCachePath(url, cacheDir);
  
  if (!existsSync(paths.dir)) {
    return false;
  }
  
  try {
    rmSync(paths.dir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.warn(`Failed to delete local cache for ${url}:`, error);
    return false;
  }
}

/**
 * 创建 S3 缓存操作实例
 */
export function createS3CacheOps(
  client: S3Client,
  bucket: string,
  prefix: string
): S3CacheOperations {
  return {
    bucket,
    prefix,
    upload: async (key: string, content: string): Promise<boolean> => {
      const result = await uploadContent(client, bucket, `${prefix}/${key}`, content);
      return result.success;
    },
    download: async (key: string): Promise<string | null> => {
      const result = await downloadContent(client, bucket, `${prefix}/${key}`);
      return result.success ? result.content : null;
    },
    exists: async (key: string): Promise<boolean> => {
      return await fileExists(client, bucket, `${prefix}/${key}`);
    },
    list: async (searchPrefix: string): Promise<string[]> => {
      const result = await listFiles(client, bucket, `${prefix}/${searchPrefix}`);
      if (!result.success) {
        return [];
      }
      // 移除 prefix 部分
      return result.files.map(f => f.key.replace(`${prefix}/`, ""));
    },
  };
}

/**
 * 检查 S3 缓存是否存在
 */
export async function hasS3Cache(
  s3Ops: S3CacheOperations,
  url: string
): Promise<boolean> {
  const hash = generateUrlHash(url);
  const metaKey = `${hash}/meta.json`;
  return await s3Ops.exists(metaKey);
}

/**
 * 从 S3 读取缓存
 */
export async function getS3Cache(
  s3Ops: S3CacheOperations,
  url: string
): Promise<CacheData | null> {
  const hash = generateUrlHash(url);
  
  // 读取 meta.json
  const metaContent = await s3Ops.download(`${hash}/meta.json`);
  if (!metaContent) {
    return null;
  }
  
  try {
    const meta: CacheMeta = JSON.parse(metaContent);
    const result: CacheData = {
      url,
      hash,
      meta,
    };
    
    // 读取各级别的内容
    const rawContent = await s3Ops.download(`${hash}/raw.md`);
    if (rawContent) {
      result.raw = rawContent;
    }
    
    const cleanContent = await s3Ops.download(`${hash}/clean.md`);
    if (cleanContent) {
      result.clean = cleanContent;
    }
    
    const summaryContent = await s3Ops.download(`${hash}/summary.md`);
    if (summaryContent) {
      result.summary = summaryContent;
    }
    
    return result;
  } catch (error) {
    console.warn(`Failed to parse S3 cache for ${url}:`, error);
    return null;
  }
}

/**
 * 上传到 S3 缓存
 */
export async function saveS3Cache(
  s3Ops: S3CacheOperations,
  url: string,
  data: {
    raw?: string;
    clean?: string;
    summary?: string;
    meta: CacheMeta;
  }
): Promise<boolean> {
  const hash = generateUrlHash(url);
  
  // 上传 meta.json
  const metaSuccess = await s3Ops.upload(`${hash}/meta.json`, JSON.stringify(data.meta, null, 2));
  if (!metaSuccess) {
    return false;
  }
  
  // 上传各个文件
  if (data.raw !== undefined) {
    const rawSuccess = await s3Ops.upload(`${hash}/raw.md`, data.raw);
    if (!rawSuccess) return false;
  }
  
  if (data.clean !== undefined) {
    const cleanSuccess = await s3Ops.upload(`${hash}/clean.md`, data.clean);
    if (!cleanSuccess) return false;
  }
  
  if (data.summary !== undefined) {
    const summarySuccess = await s3Ops.upload(`${hash}/summary.md`, data.summary);
    if (!summarySuccess) return false;
  }
  
  return true;
}

/**
 * 从 S3 同步到本地
 */
export async function syncS3ToLocal(
  s3Ops: S3CacheOperations,
  url: string,
  cacheDir: string
): Promise<CacheData | null> {
  // 获取 S3 缓存
  const s3Cache = await getS3Cache(s3Ops, url);
  if (!s3Cache) {
    return null;
  }
  
  // 保存到本地
  return saveLocalCache(url, cacheDir, {
    raw: s3Cache.raw,
    clean: s3Cache.clean,
    summary: s3Cache.summary,
  });
}

/**
 * 从本地同步到 S3
 */
export async function syncLocalToS3(
  s3Ops: S3CacheOperations,
  url: string,
  cacheDir: string
): Promise<boolean> {
  const localCache = getLocalCache(url, cacheDir);
  if (!localCache) {
    return false;
  }
  
  return await saveS3Cache(s3Ops, url, {
    raw: localCache.raw,
    clean: localCache.clean,
    summary: localCache.summary,
    meta: localCache.meta,
  });
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(cacheDir: string): {
  totalEntries: number;
  totalSize: number;
  entries: Array<{
    hash: string;
    url: string;
    size: number;
    rawSize: number;
    cleanSize?: number;
    summarySize?: number;
    crawledAt: string;
  }>;
} {
  const stats = {
    totalEntries: 0,
    totalSize: 0,
    entries: [] as Array<{
      hash: string;
      url: string;
      size: number;
      rawSize: number;
      cleanSize?: number;
      summarySize?: number;
      crawledAt: string;
    }>,
  };
  
  if (!existsSync(cacheDir)) {
    return stats;
  }
  
  const entries = readdirSync(cacheDir);
  
  for (const entry of entries) {
    const entryPath = join(cacheDir, entry);
    
    // 检查是否是目录（每个缓存条目是一个目录）
    if (!statSync(entryPath).isDirectory()) {
      continue;
    }
    
    const metaPath = join(entryPath, "meta.json");
    if (!existsSync(metaPath)) {
      continue;
    }
    
    try {
      const meta: CacheMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
      
      // 计算条目大小
      let entrySize = 0;
      const rawPath = join(entryPath, "raw.md");
      const cleanPath = join(entryPath, "clean.md");
      const summaryPath = join(entryPath, "summary.md");
      
      if (existsSync(rawPath)) {
        entrySize += statSync(rawPath).size;
      }
      if (existsSync(cleanPath)) {
        entrySize += statSync(cleanPath).size;
      }
      if (existsSync(summaryPath)) {
        entrySize += statSync(summaryPath).size;
      }
      entrySize += statSync(metaPath).size;
      
      stats.entries.push({
        hash: entry,
        url: meta.url,
        size: entrySize,
        rawSize: meta.rawSize,
        cleanSize: meta.cleanSize,
        summarySize: meta.summarySize,
        crawledAt: meta.crawledAt,
      });
      
      stats.totalEntries++;
      stats.totalSize += entrySize;
    } catch {
      // 忽略无效的缓存条目
    }
  }
  
  return stats;
}

// ============================================================
// Exports
// ============================================================

export default {
  generateUrlHash,
  getCachePath,
  hasLocalCache,
  getLocalCache,
  saveLocalCache,
  deleteLocalCache,
  createS3CacheOps,
  hasS3Cache,
  getS3Cache,
  saveS3Cache,
  syncS3ToLocal,
  syncLocalToS3,
  getCacheStats,
};