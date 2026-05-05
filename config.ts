/**
 * pi-search-crawl 配置系统
 * 
 * 配置目录: {agentDir}/pi-search-crawl/config.json
 * 环境变量覆盖: SEARXNG_URL, CRAWL4AI_URL
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// getAgentDir is optional - only available in pi-coding-agent runtime
export function getAgentDir(): string | undefined {
  try {
    // Dynamic import to avoid build errors when package is not available
    const pi = require("@mariozechner/pi-coding-agent");
    return pi.getAgentDir?.();
  } catch {
    return undefined;
  }
}

// ============================================================
// Types
// ============================================================

/** systemPrompt 配置类型 */
export interface SystemPromptConfig {
  type: "string" | "env" | "file";
  value: string;
}

/** LLM 配置 */
export interface LLMConfig {
  baseUrl: string;
  endpointType: "openai" | "anthropic";
  apiKey: string;
  modelName: string;
  systemPrompt: SystemPromptConfig;
}

/** S3 配置 */
export interface S3Config {
  url: string;
  accessKey: string;
  secretKey: string;
  api: "s3v4";
  path: "auto";
  bucket: string;
}

/** 完整配置结构 */
export interface Config {
  services: {
    searxng: {
      url: string;
    };
    crawl4ai: {
      url: string;
    };
  };
  crawl: {
    mode: "raw" | "clean" | "summary";
  };
  llm: {
    clean?: LLMConfig;
    summary?: LLMConfig;
  };
  storage: {
    cacheDir: string;
    remoteCache?: boolean;
    s3?: S3Config;
  };
  errorMode: "strict" | "graceful";
}

/** 配置验证错误 */
export interface ConfigValidationError {
  path: string;
  message: string;
}

// ============================================================
// Constants
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_DIR = join(__dirname, "..");

// ============================================================
// Default Config
// ============================================================

export const DEFAULT_CONFIG: Config = {
  services: {
    searxng: {
      url: "http://localhost:8080",
    },
    crawl4ai: {
      url: "http://localhost:11235",
    },
  },
  crawl: {
    mode: "clean",
  },
  llm: {},
  storage: {
    cacheDir: join(DEFAULT_CONFIG_DIR, ".cache"),
    remoteCache: false,
  },
  errorMode: "graceful",
};

// ============================================================
// Config Directory Resolution
// ============================================================

/**
 * 获取配置目录路径
 * 优先使用 CONFIG_DIR 环境变量
 * 其次使用 getAgentDir()/pi-search-crawl
 * 最后使用当前模块的父目录/pi-search-crawl
 */
export function getConfigDir(): string {
  // 环境变量优先级最高
  if (process.env.CONFIG_DIR) {
    return process.env.CONFIG_DIR;
  }
  
  // 尝试从 pi-coding-agent 获取 agentDir
  try {
    const agentDir = getAgentDir();
    if (agentDir) {
      return join(agentDir, "pi-search-crawl");
    }
  } catch {
    // getAgentDir not available, ignore
  }
  
  // 默认使用当前模块的父目录
  return join(DEFAULT_CONFIG_DIR, "pi-search-crawl");
}

/**
 * 获取配置文件的完整路径
 */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

// ============================================================
// Config Loading
// ============================================================

/**
 * 加载配置文件
 * 优先从 config.json 加载，环境变量可覆盖
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();
  
  // 初始化配置为深拷贝的默认值
  const config: Config = deepClone(DEFAULT_CONFIG);
  
  // 如果配置文件存在，合并配置
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      mergeConfig(config, fileConfig);
    } catch (error) {
      console.warn(`Warning: Failed to parse config file: ${configPath}`, error);
    }
  }
  
  // 环境变量覆盖
  applyEnvOverrides(config);
  
  return config;
}

/**
 * 深度合并配置
 */
function mergeConfig(target: Config, source: Partial<Config>): void {
  if (!source) return;
  
  // services
  if (source.services) {
    if (source.services.searxng) {
      target.services.searxng = {
        ...target.services.searxng,
        ...source.services.searxng,
      };
    }
    if (source.services.crawl4ai) {
      target.services.crawl4ai = {
        ...target.services.crawl4ai,
        ...source.services.crawl4ai,
      };
    }
  }
  
  // crawl
  if (source.crawl) {
    target.crawl = { ...target.crawl, ...source.crawl };
  }
  
  // llm
  if (source.llm) {
    target.llm = {
      ...target.llm,
      ...source.llm,
    };
    if (source.llm.clean) {
      target.llm.clean = { ...target.llm.clean } as LLMConfig;
    }
    if (source.llm.summary) {
      target.llm.summary = { ...target.llm.summary } as LLMConfig;
    }
  }
  
  // storage
  if (source.storage) {
    target.storage = { ...target.storage, ...source.storage };
    if (source.storage.s3) {
      target.storage.s3 = { ...target.storage.s3 } as S3Config;
    }
  }
  
  // errorMode
  if (source.errorMode) {
    target.errorMode = source.errorMode;
  }
}

/**
 * 应用环境变量覆盖
 */
function applyEnvOverrides(config: Config): void {
  // SEARXNG_URL
  if (process.env.SEARXNG_URL) {
    config.services.searxng.url = process.env.SEARXNG_URL;
  }
  
  // CRAWL4AI_URL
  if (process.env.CRAWL4AI_URL) {
    config.services.crawl4ai.url = process.env.CRAWL4AI_URL;
  }
}

// ============================================================
// System Prompt Resolution
// ============================================================

/**
 * 解析 systemPrompt 配置
 * 
 * - type="string": 直接返回 value
 * - type="env": 从环境变量读取
 * - type="file": 读取文件内容
 */
export function resolvePrompt(config: SystemPromptConfig): string {
  switch (config.type) {
    case "string":
      return config.value;
    case "env":
      return process.env[config.value] ?? "";
    case "file":
      if (existsSync(config.value)) {
        return readFileSync(config.value, "utf-8");
      }
      console.warn(`Warning: Prompt file not found: ${config.value}`);
      return "";
    default:
      console.warn(`Unknown systemPrompt type: ${config.type}`);
      return "";
  }
}

// ============================================================
// API Key Resolution
// ============================================================

/**
 * 解析 API Key，支持 ${ENV_VAR} 语法
 */
export function resolveApiKey(key: string): string {
  // 支持 ${ENV_VAR} 语法
  const match = key.match(/^\$\{(.+)\}$/);
  if (match) {
    return process.env[match[1]] ?? "";
  }
  return key;
}

// ============================================================
// Config Validation
// ============================================================

/**
 * 验证配置的有效性
 */
export function validateConfig(config: Config): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  
  // 1. 校验 crawl mode 与 LLM 配置匹配
  if (config.crawl.mode === "summary") {
    if (!config.llm.summary) {
      errors.push({
        path: "crawl.mode",
        message: "crawl.mode='summary' requires llm.summary to be configured",
      });
    }
  }
  if (config.crawl.mode === "clean" || config.crawl.mode === "summary") {
    if (!config.llm.clean) {
      errors.push({
        path: "crawl.mode",
        message: `crawl.mode='${config.crawl.mode}' requires llm.clean to be configured`,
      });
    }
  }
  
  // 2. 校验 LLM 配置的必需字段
  if (config.llm.clean) {
    const cleanErrors = validateLLMConfig(config.llm.clean, "llm.clean");
    errors.push(...cleanErrors);
  }
  if (config.llm.summary) {
    const summaryErrors = validateLLMConfig(config.llm.summary, "llm.summary");
    errors.push(...summaryErrors);
  }
  
  // 3. 校验 storage 配置
  if (!config.storage?.cacheDir) {
    errors.push({
      path: "storage.cacheDir",
      message: "storage.cacheDir is required",
    });
  }
  
  // remoteCache=true 时校验 S3 配置
  if (config.storage?.remoteCache) {
    if (!config.storage?.s3) {
      errors.push({
        path: "storage.remoteCache",
        message: "remoteCache=true requires storage.s3 to be configured",
      });
    } else {
      if (!config.storage.s3.bucket) {
        errors.push({
          path: "storage.s3.bucket",
          message: "storage.s3.bucket is required when remoteCache=true",
        });
      }
      if (!config.storage.s3.url) {
        errors.push({
          path: "storage.s3.url",
          message: "storage.s3.url is required when remoteCache=true",
        });
      }
    }
  }
  
  // 4. 校验 errorMode
  if (!["strict", "graceful"].includes(config.errorMode)) {
    errors.push({
      path: "errorMode",
      message: "errorMode must be 'strict' or 'graceful'",
    });
  }
  
  return errors;
}

/**
 * 验证 LLM 配置
 */
function validateLLMConfig(llm: LLMConfig, path: string): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  
  if (!llm.baseUrl) {
    errors.push({ path: `${path}.baseUrl`, message: "baseUrl is required" });
  }
  if (!llm.modelName) {
    errors.push({ path: `${path}.modelName`, message: "modelName is required" });
  }
  if (!llm.endpointType) {
    errors.push({ path: `${path}.endpointType`, message: "endpointType is required" });
  } else if (!["openai", "anthropic"].includes(llm.endpointType)) {
    errors.push({
      path: `${path}.endpointType`,
      message: "endpointType must be 'openai' or 'anthropic'",
    });
  }
  if (!llm.systemPrompt) {
    errors.push({ path: `${path}.systemPrompt`, message: "systemPrompt is required" });
  } else {
    if (!["string", "env", "file"].includes(llm.systemPrompt.type)) {
      errors.push({
        path: `${path}.systemPrompt.type`,
        message: "systemPrompt.type must be 'string', 'env', or 'file'",
      });
    }
    if (!llm.systemPrompt.value) {
      errors.push({ path: `${path}.systemPrompt.value`, message: "systemPrompt.value is required" });
    }
  }
  
  return errors;
}

/**
 * 校验并返回结果
 * 在 strict 模式下，如果校验失败则抛出异常
 */
export function validateConfigWithThrow(config: Config): void {
  const errors = validateConfig(config);
  if (errors.length > 0) {
    const message = errors.map((e) => `${e.path}: ${e.message}`).join("\n");
    throw new Error(`Config validation failed:\n${message}`);
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * 深拷贝对象
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 创建带错误处理配置的加载器
 * 在 graceful 模式下，校验失败只会警告不会抛出异常
 */
export function createConfigLoader(errorMode: "strict" | "graceful" = "graceful") {
  return function loadAndValidate(): Config {
    const config = loadConfig();
    
    const errors = validateConfig(config);
    
    if (errors.length > 0 && errorMode === "strict") {
      const message = errors.map((e) => `${e.path}: ${e.message}`).join("\n");
      throw new Error(`Config validation failed:\n${message}`);
    }
    
    if (errors.length > 0) {
      console.warn("⚠️ Config validation warnings:");
      errors.forEach((e) => console.warn(`  - ${e.path}: ${e.message}`));
    }
    
    return config;
  };
}

// ============================================================
// Exports
// ============================================================

export default {
  getConfigDir,
  getConfigPath,
  loadConfig,
  resolvePrompt,
  resolveApiKey,
  validateConfig,
  validateConfigWithThrow,
  createConfigLoader,
  DEFAULT_CONFIG,
};