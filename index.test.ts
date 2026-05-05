/**
 * index.ts 纯函数测试（getEffectiveMode）
 */

import { describe, it, expect } from "vitest";
import { getEffectiveMode } from "./types";

describe("getEffectiveMode", () => {
  // ===== crawl mode = raw =====
  it("should allow raw when crawl=raw, request=raw", () => {
    const { effectiveMode, degraded } = getEffectiveMode("raw", "raw");
    expect(effectiveMode).toBe("raw");
    expect(degraded).toBe(false);
  });

  it("should degrade clean to raw when crawl=raw", () => {
    const { effectiveMode, degraded, reason } = getEffectiveMode("clean", "raw");
    expect(effectiveMode).toBe("raw");
    expect(degraded).toBe(true);
    expect(reason).toContain("clean → raw");
  });

  it("should degrade summary to raw when crawl=raw", () => {
    const { effectiveMode, degraded } = getEffectiveMode("summary", "raw");
    expect(effectiveMode).toBe("raw");
    expect(degraded).toBe(true);
  });

  // ===== crawl mode = clean =====
  it("should allow raw when crawl=clean, request=raw", () => {
    const { effectiveMode, degraded } = getEffectiveMode("raw", "clean");
    expect(effectiveMode).toBe("raw");
    expect(degraded).toBe(false);
  });

  it("should allow clean when crawl=clean, request=clean", () => {
    const { effectiveMode, degraded } = getEffectiveMode("clean", "clean");
    expect(effectiveMode).toBe("clean");
    expect(degraded).toBe(false);
  });

  it("should degrade summary to clean when crawl=clean", () => {
    const { effectiveMode, degraded } = getEffectiveMode("summary", "clean");
    expect(effectiveMode).toBe("clean");
    expect(degraded).toBe(true);
  });

  // ===== crawl mode = summary =====
  it("should allow raw when crawl=summary, request=raw", () => {
    const { effectiveMode, degraded } = getEffectiveMode("raw", "summary");
    expect(effectiveMode).toBe("raw");
    expect(degraded).toBe(false);
  });

  it("should allow clean when crawl=summary, request=clean", () => {
    const { effectiveMode, degraded } = getEffectiveMode("clean", "summary");
    expect(effectiveMode).toBe("clean");
    expect(degraded).toBe(false);
  });

  it("should allow summary when crawl=summary, request=summary", () => {
    const { effectiveMode, degraded } = getEffectiveMode("summary", "summary");
    expect(effectiveMode).toBe("summary");
    expect(degraded).toBe(false);
  });

  // ===== edge cases =====
  it("should include reason string when degraded", () => {
    const { reason } = getEffectiveMode("summary", "raw");
    expect(reason).toBeDefined();
    expect(typeof reason).toBe("string");
    expect(reason!.length).toBeGreaterThan(0);
  });

  it("should have undefined reason when not degraded", () => {
    const { reason } = getEffectiveMode("raw", "summary");
    expect(reason).toBeUndefined();
  });

  it("should never return effectiveMode higher than crawlMode", () => {
    const cases: Array<[string, string]> = [
      ["raw", "raw"],
      ["clean", "raw"],
      ["summary", "raw"],
      ["raw", "clean"],
      ["clean", "clean"],
      ["summary", "clean"],
      ["raw", "summary"],
      ["clean", "summary"],
      ["summary", "summary"],
    ];

    for (const [request, crawl] of cases) {
      const { effectiveMode } = getEffectiveMode(request as any, crawl as any);
      const modeOrder = { raw: 1, clean: 2, summary: 3 };
      expect(modeOrder[effectiveMode]).toBeLessThanOrEqual(modeOrder[crawl as keyof typeof modeOrder]);
    }
  });

  it("should never have effectiveMode lower than raw", () => {
    for (const request of ["raw", "clean", "summary"]) {
      for (const crawl of ["raw", "clean", "summary"]) {
        const { effectiveMode } = getEffectiveMode(request as any, crawl as any);
        expect(["raw", "clean", "summary"]).toContain(effectiveMode);
      }
    }
  });
});
