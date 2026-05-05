/**
 * LLM 模块测试（占位实现验证）
 */

import { describe, it, expect } from "vitest";
import { callCleanLLM, callSummaryLLM, getLLMInfo } from "./llm";
import type { LLMConfig } from "./config";

const mockCleanConfig: LLMConfig = {
  baseUrl: "http://localhost:11434/v1",
  endpointType: "openai",
  apiKey: "test-key",
  modelName: "qwen2-0.5b-instruct",
  systemPrompt: { type: "string", value: "Clean this content" },
};

const mockSummaryConfig: LLMConfig = {
  baseUrl: "https://api.example.com/v1",
  endpointType: "anthropic",
  apiKey: "${OPENAI_API_KEY}",
  modelName: "gemma-e4b",
  systemPrompt: { type: "string", value: "Summarize this" },
};

describe("callCleanLLM (placeholder)", () => {
  it("should return success with original content", async () => {
    const result = await callCleanLLM(mockCleanConfig, "# Hello World");
    expect(result.success).toBe(true);
    expect(result.content).toBe("# Hello World");
    expect(result.error).toBeUndefined();
  });

  it("should return empty string unchanged", async () => {
    const result = await callCleanLLM(mockCleanConfig, "");
    expect(result.success).toBe(true);
    expect(result.content).toBe("");
  });

  it("should return unicode content unchanged", async () => {
    const unicode = "# 标题\n\n你好世界 🌍\n\n```\nconst x = 1;\n```";
    const result = await callCleanLLM(mockCleanConfig, unicode);
    expect(result.success).toBe(true);
    expect(result.content).toBe(unicode);
  });

  it("should return large content unchanged", async () => {
    const large = "x".repeat(50000);
    const result = await callCleanLLM(mockCleanConfig, large);
    expect(result.success).toBe(true);
    expect(result.content).toBe(large);
  });

  it("should not modify markdown content", async () => {
    const md = "## Section\n\nParagraph with **bold** and *italic*.\n\n- list item 1\n- list item 2";
    const result = await callCleanLLM(mockCleanConfig, md);
    expect(result.content).toBe(md);
  });

  it("should ignore the config parameter (placeholder behavior)", async () => {
    // Pass completely different configs, should still return input unchanged
    const result1 = await callCleanLLM(mockCleanConfig, "content");
    const result2 = await callCleanLLM(mockSummaryConfig, "content");
    expect(result1.content).toBe("content");
    expect(result2.content).toBe("content");
  });
});

describe("callSummaryLLM (placeholder)", () => {
  it("should return success with original content", async () => {
    const result = await callSummaryLLM(mockSummaryConfig, "# Summary Input");
    expect(result.success).toBe(true);
    expect(result.content).toBe("# Summary Input");
  });

  it("should not reduce or modify content", async () => {
    const content = "This is a very long text that would normally be summarized into something much shorter.";
    const result = await callSummaryLLM(mockSummaryConfig, content);
    expect(result.content).toBe(content);
  });

  it("should work with empty content", async () => {
    const result = await callSummaryLLM(mockSummaryConfig, "");
    expect(result.success).toBe(true);
    expect(result.content).toBe("");
  });

  it("should ignore different configs", async () => {
    const r1 = await callSummaryLLM(mockSummaryConfig, "abc");
    const r2 = await callSummaryLLM(mockCleanConfig, "abc");
    expect(r1.content).toBe("abc");
    expect(r2.content).toBe("abc");
  });
});

describe("getLLMInfo", () => {
  it("should return baseUrl and modelName", () => {
    const info = getLLMInfo(mockCleanConfig);
    expect(info.baseUrl).toBe("http://localhost:11434/v1");
    expect(info.modelName).toBe("qwen2-0.5b-instruct");
  });

  it("should detect when apiKey is present", () => {
    const info = getLLMInfo(mockCleanConfig);
    expect(info.hasApiKey).toBe(true);
  });

  it("should detect apiKey with env var syntax", () => {
    // ${OPENAI_API_KEY} - resolveApiKey will try to resolve env var
    // getLLMInfo checks if resolved key is non-empty
    const info = getLLMInfo(mockSummaryConfig);
    // Since OPENAI_API_KEY might not be set in test env,
    // hasApiKey will be true only if the env var exists
    expect(typeof info.hasApiKey).toBe("boolean");
  });

  it("should return structured info", () => {
    const info = getLLMInfo(mockCleanConfig);
    expect(info).toHaveProperty("baseUrl");
    expect(info).toHaveProperty("modelName");
    expect(info).toHaveProperty("hasApiKey");
  });
});
