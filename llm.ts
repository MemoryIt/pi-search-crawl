/**
 * LLM 调用模块
 * 
 * 阶段四前为占位实现：输入原样返回
 * 阶段四后将实现实际的 OpenAI/Anthropic API 调用
 */

import type { LLMConfig } from "./config";
import { resolveApiKey } from "./config";
import type { LLMResult } from "./types";

/**
 * 调用清洗 LLM（占位实现）
 * 
 * 阶段四前：输入原样返回
 */
export async function callCleanLLM(
  _config: LLMConfig,
  content: string
): Promise<LLMResult> {
  return {
    success: true,
    content: content,
  };
}

/**
 * 调用总结 LLM（占位实现）
 * 
 * 阶段四前：输入原样返回
 */
export async function callSummaryLLM(
  _config: LLMConfig,
  content: string
): Promise<LLMResult> {
  return {
    success: true,
    content: content,
  };
}

/**
 * 获取 LLM 调用信息（用于日志）
 */
export function getLLMInfo(config: LLMConfig): {
  baseUrl: string;
  modelName: string;
  hasApiKey: boolean;
} {
  return {
    baseUrl: config.baseUrl,
    modelName: config.modelName,
    hasApiKey: !!resolveApiKey(config.apiKey),
  };
}
