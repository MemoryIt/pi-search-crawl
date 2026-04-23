import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ============================================================
// Types
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

const SEARXNG_URL = process.env.SEARXNG_URL ?? "http://host.docker.internal:8080";
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
}
