/**
 * 缓存操作单元测试
 * 
 * 测试缓存系统的核心功能：
 * - URL 哈希生成
 * - 本地缓存读写
 * - 缓存路径管理
 * - S3 缓存操作
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
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
} from "./cache";
import { S3CacheOperations } from "./cache";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// 测试目录
const testDir = join(__dirname, ".test-cache");
const testCacheDir = join(testDir, "cache");

// Mock S3 Operations
class MockS3CacheOps implements S3CacheOperations {
  bucket = "test-bucket";
  prefix = "test-prefix";
  storage: Map<string, string> = new Map();

  async upload(key: string, content: string): Promise<boolean> {
    this.storage.set(key, content);
    return true;
  }

  async download(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async list(searchPrefix: string): Promise<string[]> {
    const results: string[] = [];
    for (const key of this.storage.keys()) {
      if (key.startsWith(searchPrefix)) {
        results.push(key);
      }
    }
    return results;
  }

  // 辅助方法：预设数据
  setData(key: string, content: string): void {
    this.storage.set(key, content);
  }

  // 辅助方法：清空数据
  clear(): void {
    this.storage.clear();
  }
}

// ============================================================
// Setup/Teardown
// ============================================================

function setupTestDir(): void {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  if (!existsSync(testCacheDir)) {
    mkdirSync(testCacheDir, { recursive: true });
  }
}

function cleanupTestDir(): void {
  try {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

// ============================================================
// Tests
// ============================================================

describe("Cache Operations", () => {

  beforeEach(() => {
    setupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  // ============================================================
  // URL Hash Tests
  // ============================================================

  describe("generateUrlHash", () => {
    it("should generate consistent hash for same URL", () => {
      const url = "https://example.com/page";
      const hash1 = generateUrlHash(url);
      const hash2 = generateUrlHash(url);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32); // MD5 produces 32 char hex
    });

    it("should generate different hashes for different URLs", () => {
      const hash1 = generateUrlHash("https://example.com/page1");
      const hash2 = generateUrlHash("https://example.com/page2");
      
      expect(hash1).not.toBe(hash2);
    });

    it("should generate different hashes for URLs with different trailing slashes", () => {
      const hash1 = generateUrlHash("https://example.com/page");
      const hash2 = generateUrlHash("https://example.com/page/");
      
      expect(hash1).not.toBe(hash2);
    });

    it("should generate different hashes for URLs with different query params order", () => {
      const hash1 = generateUrlHash("https://example.com?a=1&b=2");
      const hash2 = generateUrlHash("https://example.com?b=2&a=1");
      
      expect(hash1).not.toBe(hash2);
    });

    it("should handle unicode URLs", () => {
      const hash = generateUrlHash("https://example.com/页面");
      expect(hash).toHaveLength(32);
    });

    it("should handle empty string", () => {
      const hash = generateUrlHash("");
      expect(hash).toHaveLength(32);
    });

    it("should only contain hex characters", () => {
      const hash = generateUrlHash("https://example.com/test");
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ============================================================
  // Cache Path Tests
  // ============================================================

  describe("getCachePath", () => {
    it("should generate correct paths for URL", () => {
      const url = "https://example.com/page";
      const paths = getCachePath(url, testCacheDir);
      
      expect(paths.hash).toHaveLength(32);
      expect(paths.dir).toContain(paths.hash);
      expect(paths.rawPath).toBe(join(paths.dir, "raw.md"));
      expect(paths.cleanPath).toBe(join(paths.dir, "clean.md"));
      expect(paths.summaryPath).toBe(join(paths.dir, "summary.md"));
      expect(paths.metaPath).toBe(join(paths.dir, "meta.json"));
    });

    it("should generate consistent paths for same URL", () => {
      const url = "https://example.com/page";
      const paths1 = getCachePath(url, testCacheDir);
      const paths2 = getCachePath(url, testCacheDir);
      
      expect(paths1.hash).toBe(paths2.hash);
      expect(paths1.dir).toBe(paths2.dir);
    });

    it("should generate different hashes for different cache directories", () => {
      const url = "https://example.com/page";
      const paths1 = getCachePath(url, "/cache1");
      const paths2 = getCachePath(url, "/cache2");
      
      // Hash should be same (depends only on URL)
      expect(paths1.hash).toBe(paths2.hash);
      // But directory should be different
      expect(paths1.dir).not.toBe(paths2.dir);
    });
  });

  // ============================================================
  // Local Cache Tests
  // ============================================================

  describe("hasLocalCache", () => {
    it("should return false for non-existent cache", () => {
      const result = hasLocalCache("https://example.com/new", testCacheDir);
      expect(result).toBe(false);
    });

    it("should return true after saving raw cache", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Test" });
      
      const result = hasLocalCache(url, testCacheDir);
      expect(result).toBe(true);
    });

    it("should return false for clean mode when only raw exists", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Test" });
      
      const result = hasLocalCache(url, testCacheDir, "clean");
      expect(result).toBe(false);
    });

    it("should return true for clean mode when both raw and clean exist", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { 
        raw: "# Raw",
        clean: "# Clean"
      });
      
      const result = hasLocalCache(url, testCacheDir, "clean");
      expect(result).toBe(true);
    });

    it("should return false for summary mode when only clean exists", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { 
        raw: "# Raw",
        clean: "# Clean"
      });
      
      const result = hasLocalCache(url, testCacheDir, "summary");
      expect(result).toBe(false);
    });

    it("should return true for summary mode when all files exist", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { 
        raw: "# Raw",
        clean: "# Clean",
        summary: "# Summary"
      });
      
      const result = hasLocalCache(url, testCacheDir, "summary");
      expect(result).toBe(true);
    });
  });

  describe("getLocalCache", () => {
    it("should return null for non-existent cache", () => {
      const result = getLocalCache("https://example.com/new", testCacheDir);
      expect(result).toBeNull();
    });

    it("should return cached data with raw content", () => {
      const url = "https://example.com/test";
      const rawContent = "# Raw Content";
      saveLocalCache(url, testCacheDir, { raw: rawContent });
      
      const result = getLocalCache(url, testCacheDir);
      
      expect(result).not.toBeNull();
      expect(result!.url).toBe(url);
      expect(result!.raw).toBe(rawContent);
      expect(result!.hash).toHaveLength(32);
    });

    it("should return cached data with all content levels", () => {
      const url = "https://example.com/test";
      const content = {
        raw: "# Raw Content",
        clean: "# Clean Content",
        summary: "# Summary Content"
      };
      saveLocalCache(url, testCacheDir, content);
      
      const result = getLocalCache(url, testCacheDir);
      
      expect(result).not.toBeNull();
      expect(result!.raw).toBe(content.raw);
      expect(result!.clean).toBe(content.clean);
      expect(result!.summary).toBe(content.summary);
    });

    it("should return correct meta information", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Raw" });
      
      const result = getLocalCache(url, testCacheDir);
      
      expect(result!.meta.url).toBe(url);
      expect(result!.meta.rawSize).toBeGreaterThan(0);
      expect(result!.meta.crawledAt).toBeDefined();
      expect(result!.meta.crawlMode).toBe("raw");
    });

    it("should update crawlMode when clean is added", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Raw" });
      
      // 再添加 clean
      const existing = getLocalCache(url, testCacheDir);
      saveLocalCache(url, testCacheDir, { 
        raw: existing!.raw!,
        clean: "# Clean"
      });
      
      const result = getLocalCache(url, testCacheDir);
      expect(result!.meta.crawlMode).toBe("clean");
      expect(result!.meta.cleanSize).toBeGreaterThan(0);
    });
  });

  describe("saveLocalCache", () => {
    it("should create cache directory if not exists", () => {
      const url = "https://example.com/new";
      saveLocalCache(url, testCacheDir, { raw: "# Test" });
      
      const paths = getCachePath(url, testCacheDir);
      expect(existsSync(paths.dir)).toBe(true);
    });

    it("should save raw content correctly", () => {
      const url = "https://example.com/test";
      const rawContent = "# Raw Content\n\nSome text.";
      saveLocalCache(url, testCacheDir, { raw: rawContent });
      
      const paths = getCachePath(url, testCacheDir);
      expect(existsSync(paths.rawPath)).toBe(true);
      
      const saved = readFileSync(paths.rawPath, "utf-8");
      expect(saved).toBe(rawContent);
    });

    it("should save multiple content levels", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, {
        raw: "# Raw",
        clean: "# Clean",
        summary: "# Summary"
      });
      
      const paths = getCachePath(url, testCacheDir);
      expect(existsSync(paths.rawPath)).toBe(true);
      expect(existsSync(paths.cleanPath)).toBe(true);
      expect(existsSync(paths.summaryPath)).toBe(true);
    });

    it("should preserve existing content when updating partial", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, {
        raw: "# Original Raw",
        clean: "# Original Clean"
      });
      
      // 只更新 summary
      const existing = getLocalCache(url, testCacheDir)!;
      saveLocalCache(url, testCacheDir, {
        raw: existing.raw!,
        clean: existing.clean!,
        summary: "# New Summary"
      });
      
      const result = getLocalCache(url, testCacheDir);
      expect(result!.raw).toBe("# Original Raw");
      expect(result!.clean).toBe("# Original Clean");
      expect(result!.summary).toBe("# New Summary");
    });

    it("should update meta.json correctly", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Raw" });
      
      const paths = getCachePath(url, testCacheDir);
      const meta = JSON.parse(readFileSync(paths.metaPath, "utf-8"));
      
      expect(meta.url).toBe(url);
      expect(meta.rawSize).toBeGreaterThan(0);
      expect(meta.crawledAt).toBeDefined();
    });
  });

  describe("deleteLocalCache", () => {
    it("should return false for non-existent cache", () => {
      const result = deleteLocalCache("https://example.com/new", testCacheDir);
      expect(result).toBe(false);
    });

    it("should delete existing cache directory", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, { raw: "# Test" });
      
      const result = deleteLocalCache(url, testCacheDir);
      expect(result).toBe(true);
      
      const paths = getCachePath(url, testCacheDir);
      expect(existsSync(paths.dir)).toBe(false);
    });

    it("should completely remove cache including meta", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, {
        raw: "# Raw",
        clean: "# Clean",
        summary: "# Summary"
      });
      
      deleteLocalCache(url, testCacheDir);
      
      expect(getLocalCache(url, testCacheDir)).toBeNull();
      expect(hasLocalCache(url, testCacheDir)).toBe(false);
    });
  });

  // ============================================================
  // S3 Cache Operations Tests
  // ============================================================

  describe("createS3CacheOps", () => {
    it("should create S3 cache operations with correct bucket and prefix", () => {
      const s3Ops = createS3CacheOps({} as any, "my-bucket", "my-prefix");
      
      expect(s3Ops.bucket).toBe("my-bucket");
      expect(s3Ops.prefix).toBe("my-prefix");
    });

    it("should have all required methods", () => {
      const s3Ops = createS3CacheOps({} as any, "bucket", "prefix");
      
      expect(typeof s3Ops.upload).toBe("function");
      expect(typeof s3Ops.download).toBe("function");
      expect(typeof s3Ops.exists).toBe("function");
      expect(typeof s3Ops.list).toBe("function");
    });

    it("should prepend prefix to upload keys", async () => {
      // 创建一个带有钩子的 mock client 来验证调用参数
      let capturedCalls: Array<{ bucket: string; key: string; content: string }> = [];
      const mockClient = {
        send: async (command: any) => {
          if (command.constructor.name === "PutObjectCommand") {
            capturedCalls.push({
              bucket: command.input.Bucket,
              key: command.input.Key,
              content: command.input.Body
            });
          }
          return {};
        }
      };
      
      const s3Ops = createS3CacheOps(mockClient as any, "test-bucket", "my-prefix");
      await s3Ops.upload("hash/file.md", "content");
      
      expect(capturedCalls.length).toBe(1);
      expect(capturedCalls[0].bucket).toBe("test-bucket");
      expect(capturedCalls[0].key).toBe("my-prefix/hash/file.md");
    });

    it("should prepend prefix to download keys", async () => {
      let capturedKeys: string[] = [];
      const mockClient = {
        send: async (command: any) => {
          if (command.constructor.name === "GetObjectCommand") {
            capturedKeys.push(command.input.Key);
            return { Body: require('stream').Readable.from(Buffer.from('test content')) };
          }
          return {};
        }
      };
      
      const s3Ops = createS3CacheOps(mockClient as any, "bucket", "cache/prefix");
      await s3Ops.download("abc123/meta.json");
      
      expect(capturedKeys.length).toBe(1);
      expect(capturedKeys[0]).toBe("cache/prefix/abc123/meta.json");
    });

    it("should prepend prefix to exists keys", async () => {
      let capturedKeys: string[] = [];
      const mockClient = {
        send: async (command: any) => {
          if (command.constructor.name === "HeadObjectCommand") {
            capturedKeys.push(command.input.Key);
          }
          return { ContentLength: 100 };
        }
      };
      
      const s3Ops = createS3CacheOps(mockClient as any, "bucket", "prefix");
      await s3Ops.exists("hash/meta.json");
      
      expect(capturedKeys.length).toBe(1);
      expect(capturedKeys[0]).toBe("prefix/hash/meta.json");
    });
  });

  describe("hasS3Cache", () => {
    it("should return false when meta.json does not exist", async () => {
      const mockS3 = new MockS3CacheOps();
      
      const result = await hasS3Cache(mockS3, "https://example.com/new");
      expect(result).toBe(false);
    });

    it("should return true when meta.json exists", async () => {
      const mockS3 = new MockS3CacheOps();
      const hash = generateUrlHash("https://example.com/test");
      mockS3.setData(`${hash}/meta.json`, '{"url":"test"}');
      
      const result = await hasS3Cache(mockS3, "https://example.com/test");
      expect(result).toBe(true);
    });
  });

  describe("getS3Cache", () => {
    it("should return null when cache does not exist", async () => {
      const mockS3 = new MockS3CacheOps();
      
      const result = await getS3Cache(mockS3, "https://example.com/new");
      expect(result).toBeNull();
    });

    it("should return cached data with meta", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      const hash = generateUrlHash(url);
      
      mockS3.setData(`${hash}/meta.json`, JSON.stringify({
        url,
        crawledAt: "2024-01-01T00:00:00Z",
        crawlMode: "raw",
        rawSize: 100
      }));
      mockS3.setData(`${hash}/raw.md`, "# Raw Content");
      
      const result = await getS3Cache(mockS3, url);
      
      expect(result).not.toBeNull();
      expect(result!.url).toBe(url);
      expect(result!.hash).toBe(hash);
      expect(result!.raw).toBe("# Raw Content");
      expect(result!.meta.crawlMode).toBe("raw");
    });

    it("should return all content levels when available", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      const hash = generateUrlHash(url);
      
      mockS3.setData(`${hash}/meta.json`, JSON.stringify({
        url,
        crawledAt: "2024-01-01T00:00:00Z",
        crawlMode: "summary",
        rawSize: 100,
        cleanSize: 80,
        summarySize: 50
      }));
      mockS3.setData(`${hash}/raw.md`, "# Raw");
      mockS3.setData(`${hash}/clean.md`, "# Clean");
      mockS3.setData(`${hash}/summary.md`, "# Summary");
      
      const result = await getS3Cache(mockS3, url);
      
      expect(result!.raw).toBe("# Raw");
      expect(result!.clean).toBe("# Clean");
      expect(result!.summary).toBe("# Summary");
      expect(result!.meta.crawlMode).toBe("summary");
    });
  });

  describe("saveS3Cache", () => {
    it("should upload meta.json and content files", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      
      const result = await saveS3Cache(mockS3, url, {
        raw: "# Raw",
        clean: "# Clean",
        summary: "# Summary",
        meta: {
          url,
          crawledAt: "2024-01-01T00:00:00Z",
          crawlMode: "summary",
          rawSize: 100,
          cleanSize: 80,
          summarySize: 50
        }
      });
      
      expect(result).toBe(true);
      
      const hash = generateUrlHash(url);
      expect(await mockS3.download(`${hash}/meta.json`)).toBeDefined();
      expect(await mockS3.download(`${hash}/raw.md`)).toBe("# Raw");
      expect(await mockS3.download(`${hash}/clean.md`)).toBe("# Clean");
      expect(await mockS3.download(`${hash}/summary.md`)).toBe("# Summary");
    });

    it("should return false when meta upload fails", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      
      // Mock upload failure
      mockS3.upload = async () => false;
      
      const result = await saveS3Cache(mockS3, url, {
        raw: "# Raw",
        meta: { url, crawledAt: "", crawlMode: "raw" as const, rawSize: 0 }
      });
      
      expect(result).toBe(false);
    });

    it("should only upload provided content files", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      const hash = generateUrlHash(url);
      
      const result = await saveS3Cache(mockS3, url, {
        raw: "# Raw Only",
        meta: {
          url,
          crawledAt: "2024-01-01T00:00:00Z",
          crawlMode: "raw",
          rawSize: 100
        }
      });
      
      expect(result).toBe(true);
      expect(await mockS3.download(`${hash}/raw.md`)).toBe("# Raw Only");
      expect(await mockS3.download(`${hash}/clean.md`)).toBeNull();
      expect(await mockS3.download(`${hash}/summary.md`)).toBeNull();
    });
  });

  describe("syncS3ToLocal", () => {
    it("should return null when S3 cache does not exist", async () => {
      const mockS3 = new MockS3CacheOps();
      
      const result = await syncS3ToLocal(mockS3, "https://example.com/new", testCacheDir);
      expect(result).toBeNull();
    });

    it("should sync S3 cache to local storage", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      const hash = generateUrlHash(url);
      
      // Setup S3 data
      mockS3.setData(`${hash}/meta.json`, JSON.stringify({
        url,
        crawledAt: "2024-01-01T00:00:00Z",
        crawlMode: "clean",
        rawSize: 100,
        cleanSize: 80
      }));
      mockS3.setData(`${hash}/raw.md`, "# Raw");
      mockS3.setData(`${hash}/clean.md`, "# Clean");
      
      const result = await syncS3ToLocal(mockS3, url, testCacheDir);
      
      expect(result).not.toBeNull();
      expect(result!.raw).toBe("# Raw");
      expect(result!.clean).toBe("# Clean");
      
      // Verify local files exist
      const localCache = getLocalCache(url, testCacheDir);
      expect(localCache).not.toBeNull();
      expect(localCache!.raw).toBe("# Raw");
      expect(localCache!.clean).toBe("# Clean");
    });
  });

  describe("syncLocalToS3", () => {
    it("should return false when local cache does not exist", async () => {
      const mockS3 = new MockS3CacheOps();
      
      const result = await syncLocalToS3(mockS3, "https://example.com/new", testCacheDir);
      expect(result).toBe(false);
    });

    it("should upload local cache to S3", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/test";
      const hash = generateUrlHash(url);
      
      // Create local cache first
      saveLocalCache(url, testCacheDir, {
        raw: "# Local Raw",
        clean: "# Local Clean",
        summary: "# Local Summary"
      });
      
      const result = await syncLocalToS3(mockS3, url, testCacheDir);
      
      expect(result).toBe(true);
      
      // Verify S3 has the uploaded data
      expect(await mockS3.download(`${hash}/raw.md`)).toBe("# Local Raw");
      expect(await mockS3.download(`${hash}/clean.md`)).toBe("# Local Clean");
      expect(await mockS3.download(`${hash}/summary.md`)).toBe("# Local Summary");
      
      // Verify meta.json was uploaded
      const metaJson = await mockS3.download(`${hash}/meta.json`);
      expect(metaJson).not.toBeNull();
      const meta = JSON.parse(metaJson!);
      expect(meta.url).toBe(url);
      expect(meta.crawlMode).toBe("summary");
    });

    it("should only upload files that exist locally", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/partial";
      const hash = generateUrlHash(url);
      
      // Create local cache with only raw
      saveLocalCache(url, testCacheDir, { raw: "# Raw Only" });
      
      const result = await syncLocalToS3(mockS3, url, testCacheDir);
      
      expect(result).toBe(true);
      expect(await mockS3.download(`${hash}/raw.md`)).toBe("# Raw Only");
      // clean and summary should not exist in S3
      expect(await mockS3.download(`${hash}/clean.md`)).toBeNull();
      expect(await mockS3.download(`${hash}/summary.md`)).toBeNull();
    });

    it("should preserve content when syncing partial update", async () => {
      const mockS3 = new MockS3CacheOps();
      const url = "https://example.com/preserve";
      const hash = generateUrlHash(url);
      
      // First sync: upload raw and clean
      saveLocalCache(url, testCacheDir, {
        raw: "# Raw",
        clean: "# Clean"
      });
      await syncLocalToS3(mockS3, url, testCacheDir);
      
      // Second sync: upload only summary (simulating partial update)
      const existing = getLocalCache(url, testCacheDir)!;
      saveLocalCache(url, testCacheDir, {
        raw: existing.raw!,
        clean: existing.clean!,
        summary: "# New Summary"
      });
      await syncLocalToS3(mockS3, url, testCacheDir);
      
      // All three files should exist
      expect(await mockS3.download(`${hash}/raw.md`)).toBe("# Raw");
      expect(await mockS3.download(`${hash}/clean.md`)).toBe("# Clean");
      expect(await mockS3.download(`${hash}/summary.md`)).toBe("# New Summary");
    });
  });

  // ============================================================
  // Cache Stats Tests
  // ============================================================

  describe("getCacheStats", () => {
    it("should return empty stats for non-existent cache directory", () => {
      const stats = getCacheStats("/non/existent/path");
      
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });

    it("should count and size entries correctly", () => {
      // Create multiple cache entries
      saveLocalCache("https://example.com/1", testCacheDir, { raw: "# One" });
      saveLocalCache("https://example.com/2", testCacheDir, { 
        raw: "# Two", 
        clean: "# Clean Two" 
      });
      saveLocalCache("https://example.com/3", testCacheDir, {
        raw: "# Three",
        clean: "# Clean Three",
        summary: "# Summary Three"
      });
      
      const stats = getCacheStats(testCacheDir);
      
      expect(stats.totalEntries).toBe(3);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.entries).toHaveLength(3);
    });

    it("should include entry metadata", () => {
      const url = "https://example.com/test";
      saveLocalCache(url, testCacheDir, {
        raw: "# Raw",
        clean: "# Clean",
        summary: "# Summary"
      });
      
      const stats = getCacheStats(testCacheDir);
      const entry = stats.entries[0];
      
      expect(entry.url).toBe(url);
      expect(entry.hash).toHaveLength(32);
      expect(entry.rawSize).toBeGreaterThan(0);
      expect(entry.crawledAt).toBeDefined();
    });

    it("should calculate sizes correctly", () => {
      const rawContent = "# Raw Content";
      const cleanContent = "# Clean Content";
      
      saveLocalCache("https://example.com/test", testCacheDir, {
        raw: rawContent,
        clean: cleanContent
      });
      
      const stats = getCacheStats(testCacheDir);
      const entry = stats.entries[0];
      
      expect(entry.rawSize).toBe(rawContent.length);
      expect(entry.cleanSize).toBe(cleanContent.length);
    });
  });

  // ============================================================
  // Edge Cases Tests
  // ============================================================

  describe("Edge Cases", () => {
    it("should handle very long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(10000);
      const hash = generateUrlHash(longUrl);
      
      expect(hash).toHaveLength(32);
      
      // Should be able to save and retrieve
      saveLocalCache(longUrl, testCacheDir, { raw: "# Test" });
      const cache = getLocalCache(longUrl, testCacheDir);
      
      expect(cache).not.toBeNull();
      expect(cache!.raw).toBe("# Test");
    });

    it("should handle special characters in URLs", () => {
      const specialUrl = "https://example.com/path?query=value&special=你好";
      const hash = generateUrlHash(specialUrl);
      
      expect(hash).toHaveLength(32);
      
      saveLocalCache(specialUrl, testCacheDir, { raw: "# Test" });
      const cache = getLocalCache(specialUrl, testCacheDir);
      
      expect(cache).not.toBeNull();
    });

    it("should handle empty content", () => {
      const url = "https://example.com/empty";
      saveLocalCache(url, testCacheDir, { raw: "" });
      
      const cache = getLocalCache(url, testCacheDir);
      expect(cache!.raw).toBe("");
      expect(cache!.meta.rawSize).toBe(0);
    });

    it("should handle unicode content", () => {
      const url = "https://example.com/unicode";
      const unicodeContent = "# 标题\n\n内容：你好 🌍 مرحبا\n\n代码：`const x = 1;`";
      
      saveLocalCache(url, testCacheDir, { raw: unicodeContent });
      
      const cache = getLocalCache(url, testCacheDir);
      expect(cache!.raw).toBe(unicodeContent);
    });

    it("should overwrite existing cache with same URL", () => {
      const url = "https://example.com/overwrite";
      
      // First save
      saveLocalCache(url, testCacheDir, { raw: "# Original" });
      expect(getLocalCache(url, testCacheDir)!.raw).toBe("# Original");
      
      // Second save (overwrite)
      saveLocalCache(url, testCacheDir, { raw: "# Updated" });
      expect(getLocalCache(url, testCacheDir)!.raw).toBe("# Updated");
      
      // Should still be one entry
      const stats = getCacheStats(testCacheDir);
      expect(stats.totalEntries).toBe(1);
    });
  });
});