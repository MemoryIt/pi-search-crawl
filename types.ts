/**
 * pi-search-crawl 共享类型定义
 */

/** 内容级别 */
export type CrawlMode = "raw" | "clean" | "summary";

/** 模式级别常量（用于比较大小） */
export const MODE_LEVELS: Record<CrawlMode, number> = {
  raw: 1,
  clean: 2,
  summary: 3,
};

/** 单级缓存元数据（raw.json / clean.json / summary.json 内容） */
export interface CacheLevelMeta {
  url: string;
  uploadedAt: string;
}

/** 缓存路径信息 */
export interface CachePath {
  hash: string;
  dir: string;
  rawPath: string;
  rawJsonPath: string;
  cleanPath: string;
  cleanJsonPath: string;
  summaryPath: string;
  summaryJsonPath: string;
}

/** S3 缓存操作接口 */
export interface S3CacheOperations {
  bucket: string;
  prefix: string;
  upload: (key: string, content: string) => Promise<boolean>;
  download: (key: string) => Promise<string | null>;
  exists: (key: string) => Promise<boolean>;
  list: (prefix: string) => Promise<string[]>;
}

/** 工具执行结果 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

/** LLM 调用结果 */
export interface LLMResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * 计算有效模式（考虑 crawl mode 约束）
 */
export function getEffectiveMode(
  requestedMode: CrawlMode,
  crawlMode: CrawlMode
): { effectiveMode: CrawlMode; degraded: boolean; reason?: string } {
  const requestedLevel = MODE_LEVELS[requestedMode];
  const maxAllowedLevel = MODE_LEVELS[crawlMode];

  if (requestedLevel <= maxAllowedLevel) {
    return { effectiveMode: requestedMode, degraded: false };
  }

  const degradedMode =
    maxAllowedLevel >= MODE_LEVELS.summary ? "summary" :
    maxAllowedLevel >= MODE_LEVELS.clean ? "clean" : "raw";

  return {
    effectiveMode: degradedMode,
    degraded: true,
    reason: `crawl mode 限制: ${requestedMode} → ${degradedMode}`,
  };
}
