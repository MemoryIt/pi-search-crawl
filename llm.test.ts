/**
 * LLM 模块测试
 * 
 * 注意：这些测试需要 Pi 平台的 ModelRegistry 支持
 * 实际的 LLM 调用测试需要在集成测试中进行
 */

import { describe, it, expect } from "vitest";
import { getLLMInfo } from "./llm";
import type { LLMConfig } from "./config";

// 测试用的配置（用于 getLLMInfo 测试）
const mockConfig: LLMConfig = {
  providerName: "litellm",
  modelName: "omlx/Qwen3.5-0.8B-MLX-8bit",
  systemPrompt: { type: "string", value: "Test prompt" },
};

describe("getLLMInfo", () => {
  it("should return providerName and modelName", () => {
    const info = getLLMInfo(mockConfig);
    expect(info.providerName).toBe("litellm");
    expect(info.modelName).toBe("omlx/Qwen3.5-0.8B-MLX-8bit");
  });

  it("should return structured info", () => {
    const info = getLLMInfo(mockConfig);
    expect(info).toHaveProperty("providerName");
    expect(info).toHaveProperty("modelName");
  });
});

describe("LLMConfig type", () => {
  it("should have correct structure", () => {
    const config: LLMConfig = {
      providerName: "anthropic",
      modelName: "claude-sonnet-4-5",
      systemPrompt: { type: "string", value: "You are helpful." },
    };
    
    expect(config.providerName).toBe("anthropic");
    expect(config.modelName).toBe("claude-sonnet-4-5");
    expect(config.systemPrompt.type).toBe("string");
    expect(config.systemPrompt.value).toBe("You are helpful.");
  });

  it("should support env type systemPrompt", () => {
    const config: LLMConfig = {
      providerName: "litellm",
      modelName: "test-model",
      systemPrompt: { type: "env", value: "MY_PROMPT_VAR" },
    };
    
    expect(config.systemPrompt.type).toBe("env");
  });

  it("should support file type systemPrompt", () => {
    const config: LLMConfig = {
      providerName: "litellm",
      modelName: "test-model",
      systemPrompt: { type: "file", value: "./prompts/clean.md" },
    };
    
    expect(config.systemPrompt.type).toBe("file");
  });
});

/**
 * 注意：以下测试需要实际的 LLM 服务支持
 * 在 CI/单元测试环境中，这些测试会被跳过
 * 
 * 要运行集成测试，请使用：
 * npx vitest run --config vitest.integration.config.ts
 */

// 集成测试标记（需要实际 API 调用）
describe("callCleanLLM (integration)", () => {
  const SKIP_INTEGRATION = true; // 默认跳过，需要手动设置为 false 并配置好环境

  it.skipIf(SKIP_INTEGRATION)("should call LLM with valid config", async () => {
    // 这个测试需要:
    // 1. models.json 中配置了 litellm provider
    // 2. 有可用的 API key
    // 3. litellm 服务正在运行
    const { callCleanLLM } = await import("./llm");
    const config: LLMConfig = {
      providerName: "litellm",
      modelName: "omlx/Qwen3.5-0.8B-MLX-8bit",
      systemPrompt: { type: "string", value: "Return the text unchanged." },
    };
    
    const result = await callCleanLLM(config, "# Hello World");
    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
  });

  it.skipIf(SKIP_INTEGRATION)("should return error for nonexistent model", async () => {
    const { callCleanLLM } = await import("./llm");
    const config: LLMConfig = {
      providerName: "nonexistent-provider",
      modelName: "nonexistent-model",
      systemPrompt: { type: "string", value: "Test" },
    };
    
    const result = await callCleanLLM(config, "# Hello World");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Model not found");
  });
});
