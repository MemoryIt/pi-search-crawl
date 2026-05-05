import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadConfig } from "./config";
import { createS3Client, checkS3Health } from "./s3-client";
import {
  generateUrlHash,
  getLocalCacheLevel,
  saveLocalCacheLevel,
  createS3CacheOps,
  hasS3CacheLevel,
  getS3CacheLevel,
  saveS3CacheLevel,
} from "./cache";
import { callCleanLLM, callSummaryLLM, getLLMInfo } from "./llm";
import type { CrawlMode, S3CacheOperations } from "./types";
import { getEffectiveMode } from "./types";

// ============================================================
// Config (loaded from config.json, with env override)
// ============================================================

const config = loadConfig();
const SEARXNG_URL = config.services.searxng.url;
const CRAWL4AI_URL = config.services.crawl4ai.url;

// ============================================================
// Crawl4AI Types (for fetch_web_page)
// ============================================================

/** Crawl4AI /md 端点响应结构 */
interface Crawl4AIResponse {
  url: string;
  filter: string;
  query: string | null;
  cache: string;
  markdown: string;
  success: boolean;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_TIMEOUT_SECONDS = 60;

/** 格式化字节大小 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** onUpdate 回调类型 */
type UpdateFn = (update: { content: Array<{ type: "text"; text: string }> }) => void;

/** onUpdate 简写 */
function notify(update: UpdateFn | undefined, msg: string) {
  update?.({ content: [{ type: "text", text: msg }] });
}

/**
 * 分步确保某级缓存内容
 * 流程: 本地检查 → S3检查(remoteCache=true) → 生成 → 本地保存 → S3上传(remoteCache=true)
 */
async function ensureLevel(
  level: CrawlMode,
  url: string,
  cacheDir: string,
  s3Ops: S3CacheOperations | null,
  onUpdate: UpdateFn | undefined,
  generator: () => Promise<string>
): Promise<string> {
  // [1] 检查本地缓存
  notify(onUpdate, `🔍 [${level}] 检查本地缓存...`);
  const local = getLocalCacheLevel(url, cacheDir, level);
  if (local) {
    notify(onUpdate, `📁 ${level} 缓存命中`);
    return local.content;
  }

  // [2] 如果 S3 可用，检查 S3 缓存
  if (s3Ops) {
    const s3Exists = await hasS3CacheLevel(s3Ops, url, level);
    if (s3Exists) {
      const s3Cache = await getS3CacheLevel(s3Ops, url, level);
      if (s3Cache) {
        saveLocalCacheLevel(url, cacheDir, level, s3Cache.content);
        notify(onUpdate, `☁️ [${level}] S3 缓存命中，已下载到本地`);
        return s3Cache.content;
      }
    }
  }

  // [3] 生成内容
  const content = await generator();

  // [4] 本地保存
  saveLocalCacheLevel(url, cacheDir, level, content);

  // [5] 如果 S3 可用，上传到 S3
  if (s3Ops) {
    try {
      await saveS3CacheLevel(s3Ops, url, level, content);
      notify(onUpdate, `☁️ 上传 ${level} 到 S3...`);
    } catch {
      notify(onUpdate, `⚠️ S3 上传 ${level} 失败`);
    }
  }

  return content;
}

/**
 * 格式化结果输出
 */
function formatFetchPageResult(content: string, url: string): string {
  let output = `**Fetched Page:** ${url}\n**URL:** ${url}\n**Success:** true`;
  if (content) {
    output += `\n\n---\n\n${content}`;
  }
  return output;
}

// ============================================================
// SearXNG Types (for search tool)
// ============================================================

/** SearXNG API 返回结果项 */
interface SearXNGResult {
  url: string;
  title: string;
  content: string;
  engine: string;
  engines: string[];
  score: number;
  publishedDate?: string;
  category: string;
}

/** SearXNG API 响应结构 */
interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  answers: unknown[];
  suggestions: string[];
  corrections: unknown[];
  infoboxes: unknown[];
}

/** 搜索工具输入参数 */
interface SearchParams {
  query: string;
  num_results?: number;
  categories?: string;
  engines?: string;
  lang?: string;
  time_range?: "day" | "week" | "month" | "year";
  safesearch?: 0 | 1 | 2;
}

// ============================================================
// Constants (search-specific)
// ============================================================

const DEFAULT_NUM_RESULTS = 10;
const MAX_NUM_RESULTS = 20;

// ============================================================
// Helper Functions
// ============================================================

/**
 * 调用 SearXNG 搜索 API
 */
async function callSearXNG(params: URLSearchParams): Promise<SearXNGResponse> {
  const url = `${SEARXNG_URL}/search?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error(`Expected JSON response, got: ${contentType}`);
  }

  return response.json() as Promise<SearXNGResponse>;
}

/**
 * 格式化单条搜索结果为 Markdown
 */
function formatResult(result: SearXNGResult, index: number): string {
  const engines = result.engines?.join(", ") ?? result.engine ?? "unknown";
  const published = result.publishedDate ?? "N/A";
  const score = result.score?.toFixed(2) ?? "N/A";

  return `${index + 1}. **[${result.title}](${result.url})**  
Engines: ${engines} | Category: ${result.category} | Score: ${score} | Published: ${published}  
Content: ${result.content}`;
}

/**
 * 格式化搜索结果为 Markdown 文本
 */
function formatResults(results: SearXNGResult[]): string {
  if (results.length === 0) {
    return "未找到相关结果。";
  }

  const formatted = results.map((r, i) => formatResult(r, i)).join("\n\n");
  return `**Top Results:**\n\n${formatted}`;
}

/**
 * 调用 Crawl4AI /md 端点抓取网页
 */
async function callCrawl4AI(
  params: { url: string; word_count_threshold?: number },
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Crawl4AIResponse> {
  const payload = {
    url: params.url,
    f: "fit",
    q: null,
    c: "0",
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 如果外部传入了 signal，也要监听它
  const externalSignalHandler = () => controller.abort();
  signal?.addEventListener("abort", externalSignalHandler);

  try {
    const response = await fetch(`${CRAWL4AI_URL}/md`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", externalSignalHandler);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      throw new Error(`Expected JSON response, got: ${contentType}`);
    }

    return response.json() as Promise<Crawl4AIResponse>;
  } catch (error) {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", externalSignalHandler);
    throw error;
  }
}

// ============================================================
// Extension
// ============================================================

export default async function (pi: ExtensionAPI) {
  // ===== S3 客户端初始化（仅一次） =====
  let s3Client: ReturnType<typeof createS3Client> | null = null;
  let s3Bucket: string | null = null;
  let s3Available = false;

  if (config.storage.remoteCache && config.storage.s3) {
    s3Bucket = config.storage.s3.bucket;
    const healthy = await checkS3Health(config.storage.s3.url);

    if (healthy) {
      s3Client = createS3Client(config.storage.s3);
      s3Available = true;
      console.log("✅ S3 远程缓存已启用");
    } else {
      if (config.errorMode === "strict") {
        throw new Error("S3 storage service health check failed");
      }
      console.warn("⚠️ S3 不可用，将跳过远程缓存");
    }
  }

  pi.registerTool({
    name: "search",
    label: "Search",
    description:
      "使用本地 SearXNG 元搜索引擎进行隐私、安全的网页搜索，返回结构化的搜索结果列表。适合研究、查找资料的第一步。",
    parameters: Type.Object({
      query: Type.String({
        description:
          "搜索关键词，支持 `site:github.com`、`filetype:pdf` 等高级语法",
      }),
      num_results: Type.Optional(
        Type.Integer({ minimum: 1, maximum: MAX_NUM_RESULTS, default: DEFAULT_NUM_RESULTS })
      ),
      categories: Type.Optional(
        Type.String({
          description:
            "可选分类，逗号分隔，如 'general,images,videos,news,files,it,science,map,music'",
        })
      ),
      engines: Type.Optional(
        Type.String({
          description: "指定搜索引擎，逗号分隔，如 'google,startpage,bing,duckduckgo,brave'",
        })
      ),
      lang: Type.Optional(
        Type.String({
          description: "搜索语言，如 'zh-CN'、'en'、'all'、'auto'",
        })
      ),
      time_range: Type.Optional(
        Type.Union([
          Type.Literal("day"),
          Type.Literal("week"),
          Type.Literal("month"),
          Type.Literal("year"),
        ])
      ),
      safesearch: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 2, default: 0 })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // 参数处理
      const numResults = Math.min(
        params.num_results ?? DEFAULT_NUM_RESULTS,
        MAX_NUM_RESULTS
      );

      // 构建查询参数
      const queryParams = new URLSearchParams();
      queryParams.set("q", params.query);
      queryParams.set("format", "json");
      queryParams.set("limit", String(numResults));

      if (params.categories) {
        queryParams.set("categories", params.categories);
      }
      if (params.engines) {
        queryParams.set("engines", params.engines);
      }
      if (params.lang) {
        queryParams.set("language", params.lang);
      }
      if (params.time_range) {
        queryParams.set("time_range", params.time_range);
      }
      if (params.safesearch !== undefined && params.safesearch > 0) {
        queryParams.set("safesearch", String(params.safesearch));
      }

      try {
        const data = await callSearXNG(queryParams);

        // 取前 num_results 条结果
        const results = data.results?.slice(0, numResults) ?? [];
        const formattedResults = formatResults(results);

        const output = [
          `**Query:** ${data.query}`,
          `**Total Results:** ${data.number_of_results}`,
          "",
          formattedResults,
        ];

        // 添加建议
        if (data.suggestions?.length > 0) {
          output.push("", `**Suggestions:** ${data.suggestions.join(", ")}`);
        }

        // 添加查询纠正
        if (data.corrections?.length > 0) {
          output.push("", `**Corrections:** ${(data.corrections as string[]).join(", ")}`);
        }

        return {
          content: [{ type: "text", text: output.join("\n") }],
          details: {
            query: data.query,
            totalResults: data.number_of_results,
            returnedResults: results.length,
            suggestions: data.suggestions,
            corrections: data.corrections,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // 检查常见错误类型并提供友好的错误信息
        let hint = "";
        if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
          hint =
            "\n\n**提示：** SearXNG 服务未启动或无法连接。请检查：\n" +
            "1. Docker 容器是否运行：`docker ps | grep searxng`\n" +
            "2. 容器重启：`docker restart searxng`\n" +
            "3. 检查 SearXNG 地址是否为 `http://localhost:8080`（可通过环境变量 SEARXNG_URL 自定义）\n" +
            "4. 确认 settings.yml 中已启用 json 格式输出";
        } else if (!message.includes("JSON")) {
          hint =
            "\n\n**提示：** SearXNG 可能未正确配置 JSON 格式输出。请检查 settings.yml 中是否添加了 `json` 格式支持。";
        }

        return {
          content: [
            {
              type: "text",
              text: `**Search Error**\n\n${message}${hint}`,
            },
          ],
          details: { error: message },
          isError: true,
        };
      }
    },
  });

  // ============================================================
  // fetch_web_page Tool
  // ============================================================

  pi.registerTool({
    name: "fetch_web_page",
    label: "Fetch Web Page",
    description:
      "使用本地 Crawl4AI 从指定网页提取干净的 Markdown 内容。支持 JS 渲染和内容清洗，非常适合后续让 LLM 阅读和分析网页。",
    parameters: Type.Object({
      url: Type.String({
        description: "要抓取的网页 URL",
      }),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("raw"),
          Type.Literal("clean"),
          Type.Literal("summary"),
        ], {
          description: "内容级别: raw(原始), clean(清洗), summary(总结)。默认 clean。",
          default: "clean",
        })
      ),
      word_count_threshold: Type.Optional(
        Type.Integer({
          description: "最小段落字数阈值，用于过滤过短的段落，默认 10",
          minimum: 0,
          default: 10,
        })
      ),
      timeout: Type.Optional(
        Type.Integer({
          description: "超时时间，单位秒，默认 60",
          minimum: 5,
          maximum: 300,
          default: DEFAULT_TIMEOUT_SECONDS,
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const requestedMode: CrawlMode = params.mode ?? "clean";
      const { effectiveMode, degraded, reason } = getEffectiveMode(requestedMode, config.crawl.mode);

      if (degraded) {
        notify(onUpdate, `⚠️ 模式降级: ${reason}`);
      }

      const url = params.url;
      const cacheDir = config.storage.cacheDir;
      const timeout = (params.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
      // S3 操作实例（仅当 remoteCache=true 且 S3 可用）
      const hash = generateUrlHash(url);
      const s3Ops = (s3Client && s3Available && s3Bucket)
        ? createS3CacheOps(s3Client, s3Bucket, hash)
        : null;

      try {
        // ===== Step 1: ensure raw =====
        const rawContent = await ensureLevel("raw", url, cacheDir, s3Ops, onUpdate, async () => {
          notify(onUpdate, "🌐 正在爬取...");
          const result = await callCrawl4AI(
            { url, word_count_threshold: params.word_count_threshold },
            timeout,
            signal
          );
          if (!result.success) {
            throw new Error("Crawl4AI 返回 success=false");
          }
          notify(onUpdate, `✅ 爬取完成 (raw.md: ${formatBytes(result.markdown.length)})`);
          return result.markdown;
        });

        if (effectiveMode === "raw") {
          notify(onUpdate, "📋 返回内容: raw.md");
          return {
            content: [{ type: "text", text: formatFetchPageResult(rawContent, url) }],
            details: { url, mode: "raw" },
          };
        }

        // ===== Step 2: ensure clean =====
        const cleanContent = await ensureLevel("clean", url, cacheDir, s3Ops, onUpdate, async () => {
          if (!config.llm.clean) {
            if (config.errorMode === "strict") {
              throw new Error("llm.clean 未配置");
            }
            // graceful: 降级返回 raw
            return rawContent;
          }
          notify(onUpdate, `🧹 调用清洗模型 (${getLLMInfo(config.llm.clean).modelName})...`);
          const result = await callCleanLLM(config.llm.clean, rawContent);
          if (!result.success) {
            if (config.errorMode === "strict") throw new Error(`清洗失败: ${result.error}`);
            return rawContent;
          }
          notify(onUpdate, `✅ 清洗完成 (clean.md: ${formatBytes(result.content.length)})`);
          return result.content;
        });

        if (effectiveMode === "clean") {
          notify(onUpdate, "📋 返回内容: clean.md");
          return {
            content: [{ type: "text", text: formatFetchPageResult(cleanContent, url) }],
            details: { url, mode: "clean" },
          };
        }

        // ===== Step 3: ensure summary =====
        const summaryContent = await ensureLevel("summary", url, cacheDir, s3Ops, onUpdate, async () => {
          if (!config.llm.summary) {
            if (config.errorMode === "strict") {
              throw new Error("llm.summary 未配置");
            }
            return cleanContent;
          }
          notify(onUpdate, `📝 调用总结模型 (${getLLMInfo(config.llm.summary).modelName})...`);
          const result = await callSummaryLLM(config.llm.summary, cleanContent);
          if (!result.success) {
            if (config.errorMode === "strict") throw new Error(`总结失败: ${result.error}`);
            return cleanContent;
          }
          notify(onUpdate, `✅ 总结完成 (summary.md: ${formatBytes(result.content.length)})`);
          return result.content;
        });

        notify(onUpdate, "📋 返回内容: summary.md");
        return {
          content: [{ type: "text", text: formatFetchPageResult(summaryContent, url) }],
          details: { url, mode: "summary" },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("aborted")) {
          return {
            content: [{ type: "text", text: `**Fetch Cancelled**\n\n操作已被取消：${url}` }],
            details: { url, cancelled: true },
            isError: true,
          };
        }

        let hint = "";
        if (
          message.includes("fetch") ||
          message.includes("ECONNREFUSED") ||
          message.includes("ENOTFOUND")
        ) {
          hint =
            "\n\n**提示：** Crawl4AI 服务未启动或无法连接。请检查：\n" +
            "1. Docker 容器是否运行：`docker ps | grep crawl4ai`\n" +
            "2. 容器重启：`docker restart crawl4ai`\n" +
            "3. 检查 Crawl4AI 端口是否为 11235（可通过环境变量 CRAWL4AI_URL 自定义）";
        } else if (message.includes("timeout") || message.includes("Timeout")) {
          hint =
            "\n\n**提示：** 抓取超时。可能原因：\n" +
            "- 页面加载时间过长（可尝试增加 timeout 参数）\n" +
            "- JavaScript 渲染复杂（可尝试 mode=\"raw\" 跳过 JS 渲染）";
        }

        return {
          content: [{ type: "text", text: `**Fetch Error**\n\n${message}${hint}` }],
          details: { url, error: message },
          isError: true,
        };
      }
    },
  });
}
