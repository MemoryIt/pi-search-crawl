/**
 * 缓存操作单元测试 (per-level API)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
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
} from "./cache";
import type { S3CacheOperations, CrawlMode } from "./types";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";

const testDir = join(__dirname, ".test-cache");
const testCacheDir = join(testDir, "cache");

class MockS3CacheOps implements S3CacheOperations {
  bucket = "test-bucket";
  prefix = "test-prefix";
  storage: Map<string, string> = new Map();

  async upload(key: string, content: string): Promise<boolean> {
    this.storage.set(key, content);
    return true;
  }
  async download(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }
  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }
  async list(searchPrefix: string): Promise<string[]> {
    return [...this.storage.keys()].filter((k) => k.startsWith(searchPrefix));
  }
  setData(key: string, content: string): void {
    this.storage.set(key, content);
  }
  clear(): void {
    this.storage.clear();
  }
}

function setupTestDir(): void {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  if (!existsSync(testCacheDir)) mkdirSync(testCacheDir, { recursive: true });
}

function cleanupTestDir(): void {
  try {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

describe("Cache Operations (per-level)", () => {
  beforeEach(() => setupTestDir());
  afterEach(() => cleanupTestDir());

  // ============================================================
  // generateUrlHash
  // ============================================================
  describe("generateUrlHash", () => {
    it("should generate consistent hash for same URL", () => {
      const h1 = generateUrlHash("https://example.com/page");
      const h2 = generateUrlHash("https://example.com/page");
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(32);
    });

    it("should generate different hashes for different URLs", () => {
      expect(generateUrlHash("https://a.com")).not.toBe(generateUrlHash("https://b.com"));
    });

    it("should only contain hex characters", () => {
      expect(generateUrlHash("https://example.com")).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ============================================================
  // getCachePath
  // ============================================================
  describe("getCachePath", () => {
    it("should include all per-level paths", () => {
      const paths = getCachePath("https://example.com", testCacheDir);
      expect(paths.hash).toHaveLength(32);
      expect(paths.rawJsonPath).toBe(join(paths.dir, "raw.json"));
      expect(paths.cleanJsonPath).toBe(join(paths.dir, "clean.json"));
      expect(paths.summaryJsonPath).toBe(join(paths.dir, "summary.json"));
      expect(paths.rawPath).toBe(join(paths.dir, "raw.md"));
      expect(paths.cleanPath).toBe(join(paths.dir, "clean.md"));
      expect(paths.summaryPath).toBe(join(paths.dir, "summary.md"));
    });
  });

  // ============================================================
  // saveLocalCacheLevel + hasLocalCacheLevel + getLocalCacheLevel
  // ============================================================
  describe("Local cache per-level", () => {
    const url = "https://example.com/test";
    const levels: CrawlMode[] = ["raw", "clean", "summary"];

    it("should save and retrieve level content", () => {
      for (const level of levels) {
        saveLocalCacheLevel(url, testCacheDir, level, `# ${level} content`);
        expect(hasLocalCacheLevel(url, testCacheDir, level)).toBe(true);

        const cached = getLocalCacheLevel(url, testCacheDir, level);
        expect(cached).not.toBeNull();
        expect(cached!.content).toBe(`# ${level} content`);
        expect(cached!.meta.url).toBe(url);
        expect(cached!.meta.uploadedAt).toBeDefined();
      }
    });

    it("should not find non-existent level", () => {
      expect(hasLocalCacheLevel(url, testCacheDir, "raw")).toBe(false);
      expect(getLocalCacheLevel(url, testCacheDir, "raw")).toBeNull();
    });

    it("should check each level independently", () => {
      saveLocalCacheLevel(url, testCacheDir, "raw", "# raw");
      expect(hasLocalCacheLevel(url, testCacheDir, "raw")).toBe(true);
      expect(hasLocalCacheLevel(url, testCacheDir, "clean")).toBe(false);
      expect(hasLocalCacheLevel(url, testCacheDir, "summary")).toBe(false);

      saveLocalCacheLevel(url, testCacheDir, "clean", "# clean");
      expect(hasLocalCacheLevel(url, testCacheDir, "raw")).toBe(true);
      expect(hasLocalCacheLevel(url, testCacheDir, "clean")).toBe(true);
      expect(hasLocalCacheLevel(url, testCacheDir, "summary")).toBe(false);
    });

    it("should overwrite existing level content", () => {
      saveLocalCacheLevel(url, testCacheDir, "raw", "# first");
      saveLocalCacheLevel(url, testCacheDir, "raw", "# second");
      const cached = getLocalCacheLevel(url, testCacheDir, "raw");
      expect(cached!.content).toBe("# second");
    });

    it("should store json metadata", () => {
      saveLocalCacheLevel(url, testCacheDir, "raw", "# content");
      const paths = getCachePath(url, testCacheDir);
      const meta = JSON.parse(readFileSync(paths.rawJsonPath, "utf-8"));
      expect(meta.url).toBe(url);
      expect(meta.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should handle empty content", () => {
      saveLocalCacheLevel(url, testCacheDir, "raw", "");
      const cached = getLocalCacheLevel(url, testCacheDir, "raw");
      expect(cached!.content).toBe("");
    });

    it("should handle unicode content", () => {
      const unicode = "# 标题\n\n你好 🌍";
      saveLocalCacheLevel(url, testCacheDir, "raw", unicode);
      expect(getLocalCacheLevel(url, testCacheDir, "raw")!.content).toBe(unicode);
    });
  });

  // ============================================================
  // deleteLocalCache
  // ============================================================
  describe("deleteLocalCache", () => {
    it("should delete entire cache directory", () => {
      const url = "https://example.com/test";
      saveLocalCacheLevel(url, testCacheDir, "raw", "# raw");
      saveLocalCacheLevel(url, testCacheDir, "clean", "# clean");
      expect(hasLocalCacheLevel(url, testCacheDir, "raw")).toBe(true);

      expect(deleteLocalCache(url, testCacheDir)).toBe(true);
      expect(hasLocalCacheLevel(url, testCacheDir, "raw")).toBe(false);
      expect(hasLocalCacheLevel(url, testCacheDir, "clean")).toBe(false);
    });

    it("should return false for non-existent cache", () => {
      expect(deleteLocalCache("https://nonexistent.com", testCacheDir)).toBe(false);
    });
  });

  // ============================================================
  // S3 cache per-level
  // ============================================================
  describe("S3 cache per-level", () => {
    let mockS3: MockS3CacheOps;

    beforeEach(() => {
      mockS3 = new MockS3CacheOps();
    });

    describe("hasS3CacheLevel", () => {
      it("should return false when level json does not exist", async () => {
        expect(await hasS3CacheLevel(mockS3, "https://example.com", "raw")).toBe(false);
      });

      it("should return true when level json exists", async () => {
        const hash = generateUrlHash("https://example.com");
        mockS3.setData(`${hash}/raw.json`, JSON.stringify({ url: "https://example.com", uploadedAt: "2024-01-01T00:00:00Z" }));
        expect(await hasS3CacheLevel(mockS3, "https://example.com", "raw")).toBe(true);
      });
    });

    describe("getS3CacheLevel", () => {
      it("should return null when not cached", async () => {
        expect(await getS3CacheLevel(mockS3, "https://example.com", "raw")).toBeNull();
      });

      it("should return content and meta", async () => {
        const url = "https://example.com";
        const hash = generateUrlHash(url);
        mockS3.setData(`${hash}/raw.json`, JSON.stringify({ url, uploadedAt: "2024-01-01T00:00:00Z" }));
        mockS3.setData(`${hash}/raw.md`, "# raw content");

        const result = await getS3CacheLevel(mockS3, url, "raw");
        expect(result).not.toBeNull();
        expect(result!.content).toBe("# raw content");
        expect(result!.meta.url).toBe(url);
      });

      it("should return null when md is missing", async () => {
        const hash = generateUrlHash("https://example.com");
        mockS3.setData(`${hash}/raw.json`, JSON.stringify({ url: "https://example.com", uploadedAt: "2024-01-01T00:00:00Z" }));
        // no md file
        expect(await getS3CacheLevel(mockS3, "https://example.com", "raw")).toBeNull();
      });
    });

    describe("saveS3CacheLevel", () => {
      it("should upload json and md", async () => {
        const url = "https://example.com";
        const hash = generateUrlHash(url);
        const ok = await saveS3CacheLevel(mockS3, url, "raw", "# raw");
        expect(ok).toBe(true);
        expect(mockS3.storage.has(`${hash}/raw.json`)).toBe(true);
        expect(mockS3.storage.get(`${hash}/raw.md`)).toBe("# raw");
      });

      it("should store correct metadata", async () => {
        const url = "https://example.com";
        const hash = generateUrlHash(url);
        await saveS3CacheLevel(mockS3, url, "clean", "# clean");
        const metaJson = mockS3.storage.get(`${hash}/clean.json`)!;
        const meta = JSON.parse(metaJson);
        expect(meta.url).toBe(url);
        expect(meta.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });
  });

  // ============================================================
  // getCacheStats (per-level based)
  // ============================================================
  describe("getCacheStats", () => {
    it("should return empty stats for non-existent directory", () => {
      const stats = getCacheStats("/nonexistent");
      expect(stats.totalEntries).toBe(0);
    });

    it("should count entries using per-level json files", () => {
      saveLocalCacheLevel("https://a.com", testCacheDir, "raw", "# a");
      saveLocalCacheLevel("https://b.com", testCacheDir, "raw", "# b");
      saveLocalCacheLevel("https://b.com", testCacheDir, "clean", "# b clean");

      const stats = getCacheStats(testCacheDir);
      expect(stats.totalEntries).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it("should derive url from any available level json", () => {
      // Only save clean (no raw)
      saveLocalCacheLevel("https://only-clean.com", testCacheDir, "clean", "# clean");
      const stats = getCacheStats(testCacheDir);
      expect(stats.totalEntries).toBe(1);
      expect(stats.entries[0].url).toBe("https://only-clean.com");
    });
  });

  // ============================================================
  // createS3CacheOps
  // ============================================================
  describe("createS3CacheOps", () => {
    it("should set bucket and prefix", () => {
      const ops = createS3CacheOps({} as any, "my-bucket", "abc123");
      expect(ops.bucket).toBe("my-bucket");
      expect(ops.prefix).toBe("abc123");
      expect(typeof ops.upload).toBe("function");
      expect(typeof ops.download).toBe("function");
      expect(typeof ops.exists).toBe("function");
      expect(typeof ops.list).toBe("function");
    });
  });
});
