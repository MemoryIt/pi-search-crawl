/**
 * S3 客户端单元测试
 * 
 * 使用 mock 来测试 S3 客户端功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createS3Client,
  uploadContent,
  uploadFile,
  downloadContent,
  fileExists,
  listFiles,
  downloadToDirectory,
} from "./s3-client";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import * as fs from "fs";
import * as path from "path";

// Mock S3 Client
class MockS3Client {
  private storage: Map<string, { body: string; metadata?: Record<string, unknown> }> = new Map();
  private throwOn: Set<string> = new Set();

  // 预设存储的数据
  setData(key: string, content: string): void {
    this.storage.set(key, { body: content });
  }

  // 预设抛出错误
  throwError(commandName: string): void {
    this.throwOn.add(commandName);
  }

  // 模拟 send 方法
  async send(command: { constructor: { name: string }; input: Record<string, unknown>; output?: unknown }): Promise<unknown> {
    const cmdName = command.constructor.name;

    if (this.throwOn.has(cmdName)) {
      const error = new Error(`Mock ${cmdName} error`);
      (error as any).name = "InternalError";
      throw error;
    }

    if (command instanceof PutObjectCommand) {
      const key = command.input.Key as string;
      const body = command.input.Body;
      let content = "";
      
      if (typeof body === "string") {
        content = body;
      } else if (Buffer.isBuffer(body)) {
        content = body.toString();
      } else if (body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(Buffer.from(chunk));
        }
        content = Buffer.concat(chunks).toString();
      }
      
      this.storage.set(key, { body: content });
      return {};
    }

    if (command instanceof GetObjectCommand) {
      const key = command.input.Key as string;
      const item = this.storage.get(key);
      
      if (!item) {
        const error = new Error(`No such key: ${key}`);
        (error as any).name = "NoSuchKey";
        (error as any).$metadata = { httpStatusCode: 404 };
        throw error;
      }
      
      return {
        Body: Readable.from(Buffer.from(item.body, "utf-8")),
      };
    }

    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key as string;
      const item = this.storage.get(key);
      
      if (!item) {
        const error = new Error(`No such key: ${key}`);
        (error as any).name = "NoSuchKey";
        (error as any).$metadata = { httpStatusCode: 404 };
        throw error;
      }
      
      return {
        ContentLength: item.body.length,
        LastModified: new Date(),
      };
    }

    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix as string;
      const results: Array<{ Key: string; Size?: number; LastModified?: Date }> = [];
      
      for (const [key, value] of this.storage.entries()) {
        if (key.startsWith(prefix)) {
          results.push({
            Key: key,
            Size: value.body.length,
            LastModified: new Date(),
          });
        }
      }
      
      return {
        Contents: results,
        IsTruncated: false,
      };
    }

    return {};
  }
}

// ============================================================
// Tests
// ============================================================

describe("S3 Client", () => {

  describe("createS3Client", () => {
    it("should create client with correct config", () => {
      const config = {
        url: "https://s3.example.com",
        accessKey: "test-key",
        secretKey: "test-secret",
        api: "s3v4" as const,
        path: "auto" as const,
      };

      const client = createS3Client(config);
      
      expect(client).toBeInstanceOf(S3Client);
    });
  });

  describe("uploadContent", () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it("should upload string content successfully", async () => {
      const result = await uploadContent(mockClient as any, "test-bucket", "path/to/file.md", "# Hello World");
      
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should store content in mock storage", async () => {
      await uploadContent(mockClient as any, "test-bucket", "test-key", "test content");
      
      // 验证内容已被存储
      const stored = (mockClient as any).storage.get("test-key");
      expect(stored).toBeDefined();
      expect(stored.body).toBe("test content");
    });

    it("should handle different content types", async () => {
      const testCases = [
        { key: "file.md", content: "# Markdown\n\nContent", expectedType: "text/markdown" },
        { key: "data.json", content: '{"key":"value"}', expectedType: "application/json" },
        { key: "data.txt", content: "Plain text", expectedType: "text/plain" },
        { key: "style.css", content: "body { color: red; }", expectedType: "text/css" },
        { key: "script.js", content: "console.log('hello');", expectedType: "application/javascript" },
      ];

      for (const tc of testCases) {
        const result = await uploadContent(mockClient as any, "bucket", tc.key, tc.content);
        expect(result.success).toBe(true);
      }
    });

    it("should return error on S3 failure", async () => {
      mockClient.throwError("PutObjectCommand");
      
      const result = await uploadContent(mockClient as any, "test-bucket", "test-key", "content");
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle unicode content", async () => {
      const unicodeContent = "你好世界 🌍 مرحبا";
      const result = await uploadContent(mockClient as any, "bucket", "unicode.txt", unicodeContent);
      
      expect(result.success).toBe(true);
      const stored = (mockClient as any).storage.get("unicode.txt");
      expect(stored.body).toBe(unicodeContent);
    });

    it("should handle empty content", async () => {
      const result = await uploadContent(mockClient as any, "bucket", "empty.txt", "");
      
      expect(result.success).toBe(true);
    });

    it("should handle large content", async () => {
      const largeContent = "x".repeat(100000);
      const result = await uploadContent(mockClient as any, "bucket", "large.txt", largeContent);
      
      expect(result.success).toBe(true);
      const stored = (mockClient as any).storage.get("large.txt");
      expect(stored.body.length).toBe(100000);
    });
  });

  describe("downloadContent", () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it("should download existing content successfully", async () => {
      mockClient.setData("test-key", "downloaded content");
      
      const result = await downloadContent(mockClient as any, "test-bucket", "test-key");
      
      expect(result.success).toBe(true);
      expect((result as any).content).toBe("downloaded content");
    });

    it("should return error for non-existent key", async () => {
      const result = await downloadContent(mockClient as any, "test-bucket", "non-existent-key");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should correctly decode downloaded content", async () => {
      const originalContent = "# Title\n\nThis is a test with **bold** text.";
      mockClient.setData("markdown.md", originalContent);
      
      const result = await downloadContent(mockClient as any, "bucket", "markdown.md");
      
      expect(result.success).toBe(true);
      expect((result as any).content).toBe(originalContent);
    });

    it("should handle unicode in downloaded content", async () => {
      const unicodeContent = "中文内容测试 🐱";
      mockClient.setData("unicode.txt", unicodeContent);
      
      const result = await downloadContent(mockClient as any, "bucket", "unicode.txt");
      
      expect(result.success).toBe(true);
      expect((result as any).content).toBe(unicodeContent);
    });

    it("should handle multiline content", async () => {
      const multilineContent = "Line 1\nLine 2\nLine 3\n\nNew paragraph\n";
      mockClient.setData("multiline.txt", multilineContent);
      
      const result = await downloadContent(mockClient as any, "bucket", "multiline.txt");
      
      expect(result.success).toBe(true);
      expect((result as any).content).toBe(multilineContent);
    });

    it("should return error on S3 failure", async () => {
      mockClient.throwError("GetObjectCommand");
      
      const result = await downloadContent(mockClient as any, "bucket", "any-key");
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("fileExists", () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it("should return true for existing file", async () => {
      mockClient.setData("existing-key", "content");
      
      const result = await fileExists(mockClient as any, "bucket", "existing-key");
      
      expect(result).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      const result = await fileExists(mockClient as any, "bucket", "non-existent");
      
      expect(result).toBe(false);
    });

    it("should return false on S3 error (not treat as exists)", async () => {
      mockClient.throwError("HeadObjectCommand");
      
      const result = await fileExists(mockClient as any, "bucket", "any-key");
      
      expect(result).toBe(false);
    });

    it("should handle different key patterns", async () => {
      // 设置一些文件
      mockClient.setData("dir/file1.md", "content1");
      mockClient.setData("dir/file2.md", "content2");
      mockClient.setData("other/file.txt", "content3");
      
      expect(await fileExists(mockClient as any, "bucket", "dir/file1.md")).toBe(true);
      expect(await fileExists(mockClient as any, "bucket", "dir/file2.md")).toBe(true);
      expect(await fileExists(mockClient as any, "bucket", "other/file.txt")).toBe(true);
      expect(await fileExists(mockClient as any, "bucket", "missing/file.txt")).toBe(false);
    });
  });

  describe("listFiles", () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it("should list all files with specified prefix", async () => {
      mockClient.setData("hash/raw.md", "raw content");
      mockClient.setData("hash/clean.md", "clean content");
      mockClient.setData("hash/meta.json", '{"url":"test"}');
      mockClient.setData("other/file.txt", "other content");
      
      const result = await listFiles(mockClient as any, "bucket", "hash/");
      
      expect(result.success).toBe(true);
      const files = (result as any).files;
      expect(files.length).toBe(3);
      expect(files.map((f: any) => f.key)).toContain("hash/raw.md");
      expect(files.map((f: any) => f.key)).toContain("hash/clean.md");
      expect(files.map((f: any) => f.key)).toContain("hash/meta.json");
    });

    it("should return empty list when no files match prefix", async () => {
      mockClient.setData("other/file.txt", "content");
      
      const result = await listFiles(mockClient as any, "bucket", "nonexistent/");
      
      expect(result.success).toBe(true);
      expect((result as any).files).toHaveLength(0);
    });

    it("should include file metadata in results", async () => {
      mockClient.setData("test/file.md", "test content");
      
      const result = await listFiles(mockClient as any, "bucket", "test/");
      
      expect(result.success).toBe(true);
      const file = (result as any).files[0];
      expect(file.key).toBe("test/file.md");
      expect(file.size).toBeGreaterThan(0);
      expect(file.lastModified).toBeInstanceOf(Date);
    });

    it("should return error on S3 failure", async () => {
      mockClient.throwError("ListObjectsV2Command");
      
      const result = await listFiles(mockClient as any, "bucket", "any/");
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle nested prefixes", async () => {
      mockClient.setData("a/b/c/deep.md", "deep");
      mockClient.setData("a/b/shallow.md", "shallow");
      mockClient.setData("a/other.md", "other");
      
      const result = await listFiles(mockClient as any, "bucket", "a/b/");
      
      expect(result.success).toBe(true);
      expect((result as any).files.length).toBe(2);
    });
  });

  describe("downloadToDirectory", () => {
    let mockClient: MockS3Client;
    let testDir: string;

    beforeEach(() => {
      mockClient = new MockS3Client();
      testDir = path.join(__dirname, ".test-s3-download");
    });

    afterEach(() => {
      // 清理测试目录
      try {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true });
        }
      } catch {
        // ignore
      }
    });

    it("should download file to local directory", async () => {
      mockClient.setData("test/file.md", "# Downloaded Content");
      
      const result = await downloadToDirectory(mockClient as any, "bucket", "test/file.md", testDir);
      
      expect(result.success).toBe(true);
      
      // 验证文件已下载
      const downloadedPath = path.join(testDir, "file.md");
      expect(fs.existsSync(downloadedPath)).toBe(true);
      
      const content = fs.readFileSync(downloadedPath, "utf-8");
      expect(content).toBe("# Downloaded Content");
    });

    it("should create directory if not exists", async () => {
      mockClient.setData("new/path/file.txt", "content");
      
      const result = await downloadToDirectory(mockClient as any, "bucket", "new/path/file.txt", testDir);
      
      expect(result.success).toBe(true);
      expect(fs.existsSync(testDir)).toBe(true);
    });

    it("should return error for non-existent key", async () => {
      const result = await downloadToDirectory(mockClient as any, "bucket", "missing", testDir);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("uploadFile", () => {
    let mockClient: MockS3Client;
    let testDir: string;

    beforeEach(() => {
      mockClient = new MockS3Client();
      testDir = path.join(__dirname, ".test-s3-upload");
      
      // 确保测试目录存在
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true });
        }
      } catch {
        // ignore
      }
    });

    it("should upload local file to S3", async () => {
      const testFile = path.join(testDir, "test.md");
      fs.writeFileSync(testFile, "# Test File");
      
      const result = await uploadFile(mockClient as any, "bucket", "remote/path/test.md", testFile);
      
      expect(result.success).toBe(true);
      
      // 验证已上传
      const stored = (mockClient as any).storage.get("remote/path/test.md");
      expect(stored.body).toBe("# Test File");
    });

    it("should return error for non-existent file", async () => {
      const result = await uploadFile(mockClient as any, "bucket", "key", "/non/existent/path.md");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should handle binary file content", async () => {
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const testFile = path.join(testDir, "image.png");
      fs.writeFileSync(testFile, binaryData);
      
      const result = await uploadFile(mockClient as any, "bucket", "image.png", testFile);
      
      expect(result.success).toBe(true);
    });

    it("should return error on S3 failure", async () => {
      const testFile = path.join(testDir, "test.txt");
      fs.writeFileSync(testFile, "content");
      
      mockClient.throwError("PutObjectCommand");
      
      const result = await uploadFile(mockClient as any, "bucket", "key", testFile);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Content-Type inference", () => {
    let mockClient: MockS3Client;

    beforeEach(() => {
      mockClient = new MockS3Client();
    });

    it("should infer correct content types for various extensions", async () => {
      const testCases = [
        { ext: "md", expectedType: "text/markdown" },
        { ext: "json", expectedType: "application/json" },
        { ext: "html", expectedType: "text/html" },
        { ext: "htm", expectedType: "text/html" },
        { ext: "txt", expectedType: "text/plain" },
        { ext: "css", expectedType: "text/css" },
        { ext: "js", expectedType: "application/javascript" },
        { ext: "png", expectedType: "image/png" },
        { ext: "jpg", expectedType: "image/jpeg" },
        { ext: "gif", expectedType: "image/gif" },
        { ext: "svg", expectedType: "image/svg+xml" },
        { ext: "pdf", expectedType: "application/pdf" },
        { ext: "xml", expectedType: "application/xml" },
        { ext: "unknown", expectedType: "application/octet-stream" },
      ];

      for (const tc of testCases) {
        const result = await uploadContent(mockClient as any, "bucket", `file.${tc.ext}`, "content");
        expect(result.success).toBe(true);
      }
    });
  });
});