/**
 * 配置系统单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  loadConfig,
  resolvePrompt,
  resolveApiKey,
  validateConfig,
  getConfigPath,
  DEFAULT_CONFIG
} from "./config";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

// ============================================================
// Mock Environment Setup
// ============================================================

const originalEnv = { ...process.env };
const testConfigDir = join(__dirname, ".test-config");

function setupTestDir() {
  if (!existsSync(testConfigDir)) {
    mkdirSync(testConfigDir, { recursive: true });
  }
  // 设置环境变量指向测试目录
  process.env.CONFIG_DIR = testConfigDir;
}

function cleanupTestDir() {
  try {
    if (existsSync(testConfigDir)) {
      const configPath = join(testConfigDir, "config.json");
      if (existsSync(configPath)) {
        unlinkSync(configPath);
      }
    }
  } catch {
    // ignore
  }
}

function restoreEnv() {
  process.env = { ...originalEnv };
  delete process.env.CONFIG_DIR;
}

// ============================================================
// Tests
// ============================================================

describe("Config System", () => {

  describe("resolveApiKey", () => {
    it("should return plain key as-is", () => {
      const result = resolveApiKey("sk-test-key");
      expect(result).toBe("sk-test-key");
      expect(result).not.toBe("");
    });

    it("should resolve ${ENV_VAR} syntax when key is exactly the pattern", () => {
      process.env.TEST_API_KEY = "resolved-key";
      try {
        const result = resolveApiKey("${TEST_API_KEY}");
        expect(result).toBe("resolved-key");
      } finally {
        delete process.env.TEST_API_KEY;
      }
    });

    it("should return empty string for missing env var", () => {
      const result = resolveApiKey("${NON_EXISTENT_VAR}");
      expect(result).toBe("");
    });

    it("should NOT resolve partial env var syntax", () => {
      // 只有完全匹配 ^${VAR}$ 才会被解析
      const result = resolveApiKey("Bearer ${MY_KEY}");
      expect(result).toBe("Bearer ${MY_KEY}");
    });
    
    it("should handle empty string key", () => {
      const result = resolveApiKey("");
      expect(result).toBe("");
    });
    
    it("should handle whitespace only key", () => {
      const result = resolveApiKey("   ");
      expect(result).toBe("   ");
    });
  });

  describe("resolvePrompt", () => {
    beforeEach(() => {
      setupTestDir();
    });

    afterEach(() => {
      cleanupTestDir();
    });

    it('should return value directly for type="string"', () => {
      const config = { type: "string" as const, value: "Hello World" };
      expect(resolvePrompt(config)).toBe("Hello World");
    });

    it('should read from env for type="env"', () => {
      process.env.TEST_PROMPT = "Env Prompt Value";
      try {
        const config = { type: "env" as const, value: "TEST_PROMPT" };
        expect(resolvePrompt(config)).toBe("Env Prompt Value");
      } finally {
        delete process.env.TEST_PROMPT;
      }
    });

    it('should return empty string for missing env', () => {
      const config = { type: "env" as const, value: "NON_EXISTENT_ENV" };
      expect(resolvePrompt(config)).toBe("");
    });

    it('should read from file for type="file"', () => {
      // 确保测试目录存在
      if (!existsSync(testConfigDir)) {
        mkdirSync(testConfigDir, { recursive: true });
      }
      const testFile = join(testConfigDir, "test-prompt.txt");
      writeFileSync(testFile, "File content here");
      try {
        const config = { type: "file" as const, value: testFile };
        expect(resolvePrompt(config)).toBe("File content here");
      } finally {
        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }
      }
    });

    it('should return empty string for missing file', () => {
      const config = { type: "file" as const, value: "/non/existent/file.txt" };
      expect(resolvePrompt(config)).toBe("");
    });
  });

  describe("validateConfig", () => {
    it("should pass for valid minimal config with raw mode", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
      
      // 验证返回的是空数组实例，不是 undefined
      expect(Array.isArray(errors)).toBe(true);
    });

    it("should pass for valid config with clean mode and clean LLM", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "clean" },
        llm: {
          clean: {
            baseUrl: "http://localhost:11434/v1",
            endpointType: "openai",
            apiKey: "test-key",
            modelName: "qwen2-0.5b-instruct",
            systemPrompt: { type: "string", value: "You are a cleaner." },
          },
        },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it("should fail for summary mode without summary LLM - with specific error message", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "summary" },
        llm: {
          clean: {
            baseUrl: "http://localhost:11434/v1",
            endpointType: "openai",
            apiKey: "test-key",
            modelName: "qwen2-0.5b-instruct",
            systemPrompt: { type: "string", value: "You are a cleaner." },
          },
        },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      
      // 验证存在错误
      expect(errors.length).toBeGreaterThan(0);
      
      // 验证错误的路径和消息内容
      const modeError = errors.find(e => e.path === "crawl.mode");
      expect(modeError).toBeDefined();
      expect(modeError?.message).toContain("summary");
      expect(modeError?.message).toContain("llm.summary");
    });

    it("should fail for clean mode without clean LLM - with specific error message", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "clean" },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      
      expect(errors.length).toBeGreaterThan(0);
      
      const modeError = errors.find(e => e.path === "crawl.mode");
      expect(modeError).toBeDefined();
      expect(modeError?.message).toContain("clean");
      expect(modeError?.message).toContain("llm.clean");
    });

    it("should validate LLM config fields and return specific errors", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        llm: {
          clean: {
            baseUrl: "",
            endpointType: "invalid" as any,
            apiKey: "test-key",
            modelName: "",
            systemPrompt: { type: "invalid" as any, value: "" },
          },
        },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      
      // 验证返回了特定数量的错误
      expect(errors.length).toBeGreaterThanOrEqual(4);
      
      // 验证每个错误都有正确的路径和消息
      const baseUrlError = errors.find(e => e.path.includes("baseUrl"));
      expect(baseUrlError?.message).toBe("baseUrl is required");
      
      const endpointError = errors.find(e => e.path.includes("endpointType"));
      expect(endpointError?.message).toContain("openai");
      
      const modelNameError = errors.find(e => e.path.includes("modelName"));
      expect(modelNameError?.message).toBe("modelName is required");
      
      const systemPromptError = errors.find(e => e.path.includes("systemPrompt"));
      expect(systemPromptError).toBeDefined();
    });

    it("should fail for invalid errorMode value", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: { cacheDir: "/tmp/cache" },
        errorMode: "invalid" as any,
      };
      const errors = validateConfig(config);
      
      const errorModeError = errors.find(e => e.path === "errorMode");
      expect(errorModeError).toBeDefined();
      expect(errorModeError?.message).toContain("strict");
    });

    it("should pass for summary mode with both LLMs configured", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "summary" },
        llm: {
          clean: {
            baseUrl: "http://localhost:11434/v1",
            endpointType: "openai",
            apiKey: "test-key",
            modelName: "clean-model",
            systemPrompt: { type: "string", value: "Clean prompt" },
          },
          summary: {
            baseUrl: "http://localhost:11434/v1",
            endpointType: "openai",
            apiKey: "test-key",
            modelName: "summary-model",
            systemPrompt: { type: "string", value: "Summary prompt" },
          },
        },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });
    
    it("should fail when storage.cacheDir is missing", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: { cacheDir: "" } as any,
      };
      const errors = validateConfig(config);
      
      const cacheDirError = errors.find(e => e.path === "storage.cacheDir");
      expect(cacheDirError).toBeDefined();
      expect(cacheDirError?.message).toBe("storage.cacheDir is required");
    });
    
    it("should validate anthropic endpoint type", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        llm: {
          clean: {
            baseUrl: "https://api.anthropic.com",
            endpointType: "anthropic" as const,
            apiKey: "sk-ant",
            modelName: "claude-3",
            systemPrompt: { type: "string", value: "You are Claude." },
          },
        },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    // ===== remoteCache 校验 =====

    it("should pass when remoteCache is false", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: { cacheDir: "/tmp/cache", remoteCache: false },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it("should pass when remoteCache=true with valid S3 config", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: {
          cacheDir: "/tmp/cache",
          remoteCache: true,
          s3: {
            url: "https://s3.example.com",
            accessKey: "key",
            secretKey: "secret",
            api: "s3v4" as const,
            path: "auto" as const,
            bucket: "my-bucket",
          },
        },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });

    it("should fail when remoteCache=true but no s3 config", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: {
          cacheDir: "/tmp/cache",
          remoteCache: true,
        },
      };
      const errors = validateConfig(config);
      const s3Error = errors.find(e => e.path === "storage.remoteCache");
      expect(s3Error).toBeDefined();
      expect(s3Error!.message).toContain("storage.s3");
    });

    it("should fail when remoteCache=true but s3.bucket is empty", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: {
          cacheDir: "/tmp/cache",
          remoteCache: true,
          s3: {
            url: "https://s3.example.com",
            accessKey: "key",
            secretKey: "secret",
            api: "s3v4" as const,
            path: "auto" as const,
            bucket: "",
          },
        },
      };
      const errors = validateConfig(config);
      const bucketError = errors.find(e => e.path === "storage.s3.bucket");
      expect(bucketError).toBeDefined();
      expect(bucketError!.message).toContain("bucket");
    });

    it("should fail when remoteCache=true but s3.url is empty", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: {
          cacheDir: "/tmp/cache",
          remoteCache: true,
          s3: {
            url: "",
            accessKey: "key",
            secretKey: "secret",
            api: "s3v4" as const,
            path: "auto" as const,
            bucket: "my-bucket",
          },
        },
      };
      const errors = validateConfig(config);
      const urlError = errors.find(e => e.path === "storage.s3.url");
      expect(urlError).toBeDefined();
      expect(urlError!.message).toContain("s3.url");
    });

    it("should pass when remoteCache is undefined (defaults)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        crawl: { mode: "raw" },
        storage: { cacheDir: "/tmp/cache" },
      };
      const errors = validateConfig(config);
      expect(errors).toHaveLength(0);
    });
  });

  describe("loadConfig", () => {
    beforeEach(() => {
      setupTestDir();
    });

    afterEach(() => {
      cleanupTestDir();
      restoreEnv();
    });

    it("should load default config when no config file exists", () => {
      const config = loadConfig();
      expect(config.services.searxng.url).toBe("http://localhost:8080");
      expect(config.services.crawl4ai.url).toBe("http://localhost:11235");
      expect(config.crawl.mode).toBe("clean");
      expect(config.errorMode).toBe("graceful");
    });

    it("should load config from config.json", () => {
      const configPath = join(testConfigDir, "config.json");
      const customConfig = {
        services: {
          searxng: { url: "http://custom-searxng:8080" },
          crawl4ai: { url: "http://custom-crawl4ai:11235" },
        },
        crawl: { mode: "summary" },
        llm: {
          clean: {
            baseUrl: "http://localhost:11434/v1",
            endpointType: "openai" as const,
            apiKey: "test-key",
            modelName: "test-model",
            systemPrompt: { type: "string" as const, value: "Test prompt" },
          },
        },
        storage: { cacheDir: "/custom/cache" },
        errorMode: "strict" as const,
      };
      writeFileSync(configPath, JSON.stringify(customConfig));

      const config = loadConfig();
      
      expect(config.services.searxng.url).toBe("http://custom-searxng:8080");
      expect(config.services.crawl4ai.url).toBe("http://custom-crawl4ai:11235");
      expect(config.crawl.mode).toBe("summary");
      expect(config.storage.cacheDir).toBe("/custom/cache");
      expect(config.errorMode).toBe("strict");
    });

    it("should override config with environment variables", () => {
      const configPath = join(testConfigDir, "config.json");
      writeFileSync(configPath, JSON.stringify({}));

      process.env.SEARXNG_URL = "http://env-searxng:8080";
      process.env.CRAWL4AI_URL = "http://env-crawl4ai:11235";

      try {
        const config = loadConfig();
        expect(config.services.searxng.url).toBe("http://env-searxng:8080");
        expect(config.services.crawl4ai.url).toBe("http://env-crawl4ai:11235");
      } finally {
        delete process.env.SEARXNG_URL;
        delete process.env.CRAWL4AI_URL;
      }
    });

    it("should handle invalid JSON gracefully", () => {
      const configPath = join(testConfigDir, "config.json");
      writeFileSync(configPath, "invalid json {");

      // 应该在加载时给出警告但不崩溃
      expect(() => loadConfig()).not.toThrow();
      
      const config = loadConfig();
      // 应该回退到默认配置
      expect(config.services.searxng.url).toBe("http://localhost:8080");
    });

    it("should partial merge config", () => {
      const configPath = join(testConfigDir, "config.json");
      const partialConfig = {
        crawl: { mode: "raw" },
      };
      writeFileSync(configPath, JSON.stringify(partialConfig));

      const config = loadConfig();
      
      // 应该有默认的 services 配置
      expect(config.services.searxng.url).toBe("http://localhost:8080");
      expect(config.services.crawl4ai.url).toBe("http://localhost:11235");
      // 但 crawl.mode 被覆盖
      expect(config.crawl.mode).toBe("raw");
    });
  });

  describe("getConfigPath", () => {
    beforeEach(() => {
      setupTestDir();
    });

    afterEach(() => {
      cleanupTestDir();
      restoreEnv();
    });

    it("should return path in CONFIG_DIR when set", () => {
      const path = getConfigPath();
      expect(path).toBe(join(testConfigDir, "config.json"));
    });

    it("should use default path when CONFIG_DIR not set", () => {
      delete process.env.CONFIG_DIR;
      const path = getConfigPath();
      expect(path).toContain("config.json");
    });
  });

  describe("DEFAULT_CONFIG", () => {
    it("should have correct structure", () => {
      expect(DEFAULT_CONFIG).toHaveProperty("services");
      expect(DEFAULT_CONFIG).toHaveProperty("services.searxng");
      expect(DEFAULT_CONFIG).toHaveProperty("services.crawl4ai");
      expect(DEFAULT_CONFIG).toHaveProperty("crawl");
      expect(DEFAULT_CONFIG).toHaveProperty("crawl.mode");
      expect(DEFAULT_CONFIG).toHaveProperty("storage");
      expect(DEFAULT_CONFIG).toHaveProperty("storage.cacheDir");
      expect(DEFAULT_CONFIG).toHaveProperty("errorMode");
    });

    it("should have valid default values", () => {
      expect(DEFAULT_CONFIG.services.searxng.url).toBe("http://localhost:8080");
      expect(DEFAULT_CONFIG.services.crawl4ai.url).toBe("http://localhost:11235");
      expect(DEFAULT_CONFIG.crawl.mode).toBe("clean");
      expect(DEFAULT_CONFIG.errorMode).toBe("graceful");
    });
  });
});