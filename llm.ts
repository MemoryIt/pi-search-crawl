/**
 * LLM 调用模块
 * 
 * 使用 Pi 平台的 ModelRegistry 和 pi-ai 调用 LLM
 * 模型配置通过 config.json 指定 providerName 和 modelName
 * 实际的模型定义和认证信息从 Pi 的 models.json 获取
 */

import { completeSimple, type AssistantMessage } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { LLMConfig } from "./config";
import type { LLMResult } from "./types";
import { resolvePrompt } from "./config";

// ============================================================
// 单例初始化（插件加载时创建一次）
// ============================================================

let authStorage: AuthStorage | null = null;
let modelRegistry: ModelRegistry | null = null;

/**
 * 获取 AuthStorage 单例
 * 自动读取 Pi 的配置 (auth.json 和环境变量)
 */
function getAuthStorage(): AuthStorage {
  if (!authStorage) {
    authStorage = AuthStorage.create();
  }
  return authStorage;
}

/**
 * 获取 ModelRegistry 单例
 * 自动加载 Pi 的 models.json 配置
 */
function getModelRegistry(): ModelRegistry {
  if (!modelRegistry) {
    modelRegistry = ModelRegistry.create(getAuthStorage());
  }
  return modelRegistry;
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从 AssistantMessage 提取纯文本内容
 */
function extractTextContent(message: AssistantMessage): string {
  const parts: string[] = [];

  for (const block of message.content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
    // 跳过 thinking 和 toolCall 类型的内容
  }

  return parts.join("\n");
}

// ============================================================
// 核心调用函数
// ============================================================

/**
 * 使用 pi-ai 调用 LLM
 * 
 * @param config LLM 配置（包含 providerName, modelName, systemPrompt）
 * @param content 输入内容
 * @returns LLMResult 包含 success, content, error
 */
async function callLLM(
  config: LLMConfig,
  content: string
): Promise<LLMResult> {
  const registry = getModelRegistry();

  // 从 ModelRegistry 查找模型
  const model = registry.find(config.providerName, config.modelName);

  if (!model) {
    // 尝试列出可用的模型帮助调试
    const availableModels = registry.getAvailable()
      .filter(m => m.provider === config.providerName)
      .map(m => m.id);
    
    let hint = `请检查 models.json 中是否配置了 provider="${config.providerName}", model="${config.modelName}"`;
    if (availableModels.length > 0) {
      hint += `\n该 provider 下可用的模型: ${availableModels.join(", ")}`;
    }

    return {
      success: false,
      content: "",
      error: `Model not found: ${config.providerName}/${config.modelName}\n${hint}`
    };
  }

  // 获取 API Key 和 Headers
  // 优先从 models.json 中读取（providerRequestConfigs），也支持 auth.json 和环境变量
  const authResult = await registry.getApiKeyAndHeaders(model);
  
  if (!authResult.ok) {
    return {
      success: false,
      content: "",
      error: `No API key for provider: ${config.providerName}\n${authResult.error}`
    };
  }

  try {
    // 构建 system prompt
    const systemPrompt = resolvePrompt(config.systemPrompt);

    // 调用 pi-ai，传入获取到的 apiKey
    const result = await completeSimple(model, {
      systemPrompt,
      messages: [{ role: "user", content }] as any
    }, {
      apiKey: authResult.apiKey,
      headers: authResult.headers
    });

    // 提取文本内容
    const textContent = extractTextContent(result);

    return {
      success: !result.errorMessage,
      content: textContent,
      error: result.errorMessage
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================================
// 导出接口（保持原有接口不变）
// ============================================================

/**
 * 调用清洗 LLM
 * 
 * @param config LLM 配置
 * @param content 需要清洗的原始内容
 */
export async function callCleanLLM(
  config: LLMConfig,
  content: string
): Promise<LLMResult> {
  return callLLM(config, content);
}

/**
 * 调用总结 LLM
 * 
 * @param config LLM 配置
 * @param content 需要总结的清洗后内容
 */
export async function callSummaryLLM(
  config: LLMConfig,
  content: string
): Promise<LLMResult> {
  return callLLM(config, content);
}

/**
 * 获取 LLM 调用信息（用于日志）
 */
export function getLLMInfo(config: LLMConfig): {
  providerName: string;
  modelName: string;
} {
  return {
    providerName: config.providerName,
    modelName: config.modelName,
  };
}
