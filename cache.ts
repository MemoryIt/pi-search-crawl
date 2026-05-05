/**
 * 缓存操作封装
 * 
 * 提供本地缓存和 S3 缓存的统一管理，采用 per-level 设计：
 * - 每级独立缓存文件（raw.md + raw.json, clean.md + clean.json, summary.md + summary.json）
 * - URL 哈希计算
 * - 本地缓存读写
 * - S3 缓存同步
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { uploadContent, downloadContent, fileExists, listFiles } from "./s3-client";
import type { CrawlMode, CacheLevelMeta, CachePath, S3CacheOperations } from "./types";

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
    rawJsonPath: join(dir, "raw.json"),
    cleanPath: join(dir, "clean.md"),
    cleanJsonPath: join(dir, "clean.json"),
    summaryPath: join(dir, "summary.md"),
    summaryJsonPath: join(dir, "summary.json"),
  };
}

// ============================================================
// Local Cache (per-level)
// ============================================================

/**
 * 检查本地某级别缓存是否存在
 * 判断依据: {hash}/{level}.json 文件存在
 */
export function hasLocalCacheLevel(
  url: string,
  cacheDir: string,
  level: CrawlMode
): boolean {
  const paths = getCachePath(url, cacheDir);
  const jsonPath = getLevelJsonPath(paths, level);
  return existsSync(jsonPath);
}

/**
 * 读取本地某级别缓存
 * 返回内容字符串和元数据
 */
export function getLocalCacheLevel(
  url: string,
  cacheDir: string,
  level: CrawlMode
): { content: string; meta: CacheLevelMeta } | null {
  const paths = getCachePath(url, cacheDir);
  const jsonPath = getLevelJsonPath(paths, level);
  const mdPath = getLevelMdPath(paths, level);

  if (!existsSync(jsonPath) || !existsSync(mdPath)) {
    return null;
  }

  try {
    const meta: CacheLevelMeta = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const content = readFileSync(mdPath, "utf-8");
    return { content, meta };
  } catch {
    return null;
  }
}

/**
 * 保存某级别缓存到本地
 * 写入 {level}.md 和 {level}.json
 */
export function saveLocalCacheLevel(
  url: string,
  cacheDir: string,
  level: CrawlMode,
  content: string
): CacheLevelMeta {
  const paths = getCachePath(url, cacheDir);

  // 创建缓存目录
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true });
  }

  const meta: CacheLevelMeta = {
    url,
    uploadedAt: new Date().toISOString(),
  };

  const jsonPath = getLevelJsonPath(paths, level);
  const mdPath = getLevelMdPath(paths, level);

  writeFileSync(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
  writeFileSync(mdPath, content, "utf-8");

  return meta;
}

/**
 * 删除本地缓存（整个 hash 目录）
 */
export function deleteLocalCache(url: string, cacheDir: string): boolean {
  const paths = getCachePath(url, cacheDir);

  if (!existsSync(paths.dir)) {
    return false;
  }

  try {
    rmSync(paths.dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// S3 Cache (per-level)
// ============================================================

/**
 * 创建 S3 缓存操作实例
 * prefix 为 URL hash，所有 key 前面都会加上 prefix/
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
      if (!result.success) return [];
      return result.files.map((f) => f.key.replace(`${prefix}/`, ""));
    },
  };
}

/**
 * 检查 S3 某级别缓存是否存在
 * 判断依据: {hash}/{level}.json 存在
 */
export async function hasS3CacheLevel(
  s3Ops: S3CacheOperations,
  _url: string,
  level: CrawlMode
): Promise<boolean> {
  // s3Ops 已经以 hash 为 prefix，这里只需传 level 文件名
  return await s3Ops.exists(`${level}.json`);
}

/**
 * 从 S3 读取某级别缓存
 * 返回内容字符串和元数据
 */
export async function getS3CacheLevel(
  s3Ops: S3CacheOperations,
  _url: string,
  level: CrawlMode
): Promise<{ content: string; meta: CacheLevelMeta } | null> {
  // s3Ops 已经以 hash 为 prefix，这里只需传 level 文件名
  const jsonContent = await s3Ops.download(`${level}.json`);
  if (!jsonContent) return null;

  const mdContent = await s3Ops.download(`${level}.md`);
  if (!mdContent) return null;

  try {
    const meta: CacheLevelMeta = JSON.parse(jsonContent);
    return { content: mdContent, meta };
  } catch {
    return null;
  }
}

/**
 * 上传某级别缓存到 S3
 * 上传 {level}.md 和 {level}.json
 */
export async function saveS3CacheLevel(
  s3Ops: S3CacheOperations,
  url: string,
  level: CrawlMode,
  content: string
): Promise<boolean> {
  const meta: CacheLevelMeta = {
    url,
    uploadedAt: new Date().toISOString(),
  };

  // s3Ops 已经以 hash 为 prefix，这里只需传 level 文件名
  const jsonOk = await s3Ops.upload(`${level}.json`, JSON.stringify(meta));
  if (!jsonOk) return false;

  const mdOk = await s3Ops.upload(`${level}.md`, content);
  return mdOk;
}

// ============================================================
// Cache Stats
// ============================================================

/**
 * 获取缓存统计信息
 * 遍历 cacheDir 下所有 hash 目录，读取各 level 的 .json 文件
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
    uploadedAt: string;
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
      uploadedAt: string;
    }>,
  };

  if (!existsSync(cacheDir)) return stats;

  const entries = readdirSync(cacheDir);

  for (const entry of entries) {
    const entryPath = join(cacheDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    // 查找各 level 的 json 和 md
    const rawJsonPath = join(entryPath, "raw.json");
    const cleanJsonPath = join(entryPath, "clean.json");
    const summaryJsonPath = join(entryPath, "summary.json");

    const rawMdPath = join(entryPath, "raw.md");
    const cleanMdPath = join(entryPath, "clean.md");
    const summaryMdPath = join(entryPath, "summary.md");

    // 从第一个可用的 json 获取 url
    let url = "";
    let uploadedAt = "";
    const rawMeta = readJsonSafe(rawJsonPath);
    const cleanMeta = readJsonSafe(cleanJsonPath);
    const summaryMeta = readJsonSafe(summaryJsonPath);

    if (rawMeta) {
      url = rawMeta.url;
      uploadedAt = rawMeta.uploadedAt;
    } else if (cleanMeta) {
      url = cleanMeta.url;
      uploadedAt = cleanMeta.uploadedAt;
    } else if (summaryMeta) {
      url = summaryMeta.url;
      uploadedAt = summaryMeta.uploadedAt;
    } else {
      continue; // 没有可用的元数据
    }

    let entrySize = 0;
    let rawSize = 0;
    let cleanSize: number | undefined;
    let summarySize: number | undefined;

    if (existsSync(rawMdPath)) {
      rawSize = statSync(rawMdPath).size;
      entrySize += rawSize;
    }
    if (existsSync(cleanMdPath)) {
      cleanSize = statSync(cleanMdPath).size;
      entrySize += cleanSize;
    }
    if (existsSync(summaryMdPath)) {
      summarySize = statSync(summaryMdPath).size;
      entrySize += summarySize;
    }
    // 加上 json 文件大小
    if (existsSync(rawJsonPath)) entrySize += statSync(rawJsonPath).size;
    if (existsSync(cleanJsonPath)) entrySize += statSync(cleanJsonPath).size;
    if (existsSync(summaryJsonPath)) entrySize += statSync(summaryJsonPath).size;

    stats.entries.push({
      hash: entry,
      url,
      size: entrySize,
      rawSize,
      cleanSize,
      summarySize,
      uploadedAt,
    });

    stats.totalEntries++;
    stats.totalSize += entrySize;
  }

  return stats;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 获取某级别的 json 文件路径
 */
function getLevelJsonPath(paths: CachePath, level: CrawlMode): string {
  switch (level) {
    case "raw": return paths.rawJsonPath;
    case "clean": return paths.cleanJsonPath;
    case "summary": return paths.summaryJsonPath;
  }
}

/**
 * 获取某级别的 md 文件路径
 */
function getLevelMdPath(paths: CachePath, level: CrawlMode): string {
  switch (level) {
    case "raw": return paths.rawPath;
    case "clean": return paths.cleanPath;
    case "summary": return paths.summaryPath;
  }
}

/**
 * 安全读取 json 文件
 */
function readJsonSafe(path: string): CacheLevelMeta | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ============================================================
// Exports
// ============================================================

export default {
  generateUrlHash,
  getCachePath,
  hasLocalCacheLevel,
  getLocalCacheLevel,
  saveLocalCacheLevel,
  deleteLocalCache,
  createS3CacheOps,
  hasS3CacheLevel,
  getS3CacheLevel,
  saveS3CacheLevel,
  getCacheStats,
};
