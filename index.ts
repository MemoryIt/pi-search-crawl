import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

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
// Crawl4AI Constants
// ============================================================

const CRAWL4AI_URL = process.env.CRAWL4AI_URL ?? "http://localhost:11235";

const DEFAULT_TIMEOUT_SECONDS = 60;

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
// Constants
// ============================================================

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://localhost:8080";
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
  params: { url: string; f?: string; word_count_threshold?: number },
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Crawl4AIResponse> {
  const payload = {
    url: params.url,
    f: params.f ?? "fit",
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

/**
 * 格式化网页抓取结果为 Markdown
 */
function formatFetchResult(
  result: Crawl4AIResponse,
  extractInstruction?: string
): string {
  let output = `**Fetched Page:** ${result.url}\n**URL:** ${result.url}\n**Success:** ${result.success}`;

  if (result.markdown) {
    output += `\n\n---\n\n${result.markdown}`;
  }

  if (extractInstruction) {
    output += `\n\n---\n\n**提取要求：**\n${extractInstruction}`;
  }

  return output;
}

// ============================================================
// Extension
// ============================================================

export default function (pi: ExtensionAPI) {
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
      f: Type.Optional(
        Type.String({
          description: '内容过滤器，推荐值 "fit"（智能清洗）或 "raw"（原始内容）',
          default: "fit",
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
      extract_instruction: Type.Optional(
        Type.String({
          description:
            "可选的提取指令，如果提供，将附加在返回的 markdown 后供 LLM 参考。例如：'提取文章的标题、作者和发布日期'",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      // 参数处理
      const timeout = (params.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
      const filter = params.f ?? "fit";

      // 输出调试信息
      const debugInfo = `Fetching URL: ${params.url} (filter: ${filter})`;
      console.log(debugInfo);
      onUpdate?.({
        content: [{ type: "text", text: debugInfo }],
      });

      try {
        const result = await callCrawl4AI(
          {
            url: params.url,
            f: filter,
            word_count_threshold: params.word_count_threshold,
          },
          timeout,
          signal
        );

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `**Fetch Failed**\n\nURL: ${params.url}\nCrawl4AI 返回 success=false，可能是因为：\n- 页面无法访问或不存在\n- JavaScript 渲染超时\n- robots.txt 禁止抓取`,
              },
            ],
            details: { url: params.url, success: false },
            isError: true,
          };
        }

        const formatted = formatFetchResult(result, params.extract_instruction);

        return {
          content: [{ type: "text", text: formatted }],
          details: {
            url: result.url,
            success: result.success,
            markdownLength: result.markdown.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // 检查是否是取消操作
        if (message.includes("aborted")) {
          return {
            content: [{ type: "text", text: `**Fetch Cancelled**\n\n操作已被取消：${params.url}` }],
            details: { url: params.url, cancelled: true },
            isError: true,
          };
        }

        // 检查常见错误类型并提供友好的错误信息
        let hint = "";
        if (
          message.includes("fetch") ||
          message.includes("ECONNREFUSED") ||
          message.includes("ENOTFOUND") ||
          message.includes("aborted")
        ) {
          hint =
            "\n\n**提示：** Crawl4AI 服务未启动或无法连接。请检查：\n" +
            "1. Docker 容器是否运行：`docker ps | grep crawl4ai`\n" +
            "2. 容器重启：`docker restart crawl4ai`\n" +
            "3. 检查 Crawl4AI 端口是否为 11235（可通过环境变量 CRAWL4AI_URL 自定义）\n" +
            "4. 如果在 pi-less-yolo 环境，已自动使用 host.docker.internal";
        } else if (message.includes("timeout") || message.includes("Timeout")) {
          hint =
            "\n\n**提示：** 抓取超时。可能原因：\n" +
            "- 页面加载时间过长（可尝试增加 timeout 参数）\n" +
            "- JavaScript 渲染复杂（可尝试 f=\"raw\" 跳过 JS 渲染）\n" +
            "- 网络连接问题";
        }

        return {
          content: [
            {
              type: "text",
              text: `**Fetch Error**\n\n${message}${hint}`,
            },
          ],
          details: { url: params.url, error: message },
          isError: true,
        };
      }
    },
  });
}
