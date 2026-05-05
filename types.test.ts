/**
 * 共享类型和常量测试
 */

import { describe, it, expect } from "vitest";
import { MODE_LEVELS } from "./types";
import type { CrawlMode } from "./types";

describe("MODE_LEVELS", () => {
  it("should have raw as lowest level", () => {
    expect(MODE_LEVELS.raw).toBe(1);
    expect(MODE_LEVELS.raw).toBeLessThan(MODE_LEVELS.clean);
    expect(MODE_LEVELS.raw).toBeLessThan(MODE_LEVELS.summary);
  });

  it("should have clean between raw and summary", () => {
    expect(MODE_LEVELS.clean).toBe(2);
    expect(MODE_LEVELS.clean).toBeGreaterThan(MODE_LEVELS.raw);
    expect(MODE_LEVELS.clean).toBeLessThan(MODE_LEVELS.summary);
  });

  it("should have summary as highest level", () => {
    expect(MODE_LEVELS.summary).toBe(3);
    expect(MODE_LEVELS.summary).toBeGreaterThan(MODE_LEVELS.raw);
    expect(MODE_LEVELS.summary).toBeGreaterThan(MODE_LEVELS.clean);
  });

  it("should maintain the ordering raw < clean < summary", () => {
    const levels: CrawlMode[] = ["raw", "clean", "summary"];
    for (let i = 1; i < levels.length; i++) {
      expect(MODE_LEVELS[levels[i]]).toBeGreaterThan(MODE_LEVELS[levels[i - 1]]);
    }
  });

  it("should have numeric values suitable for comparison", () => {
    expect(MODE_LEVELS.raw).toEqual(expect.any(Number));
    expect(MODE_LEVELS.clean).toEqual(expect.any(Number));
    expect(MODE_LEVELS.summary).toEqual(expect.any(Number));
  });

  it("should allow direct comparison between levels", () => {
    expect(MODE_LEVELS.clean > MODE_LEVELS.raw).toBe(true);
    expect(MODE_LEVELS.summary > MODE_LEVELS.clean).toBe(true);
    expect(MODE_LEVELS.raw < MODE_LEVELS.summary).toBe(true);
    expect(MODE_LEVELS.raw < MODE_LEVELS.clean).toBe(true);
    expect(MODE_LEVELS.clean < MODE_LEVELS.summary).toBe(true);
  });
});
