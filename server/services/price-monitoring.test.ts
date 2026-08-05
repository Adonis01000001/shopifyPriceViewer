import { describe, expect, it } from "vitest";
import { forEachConcurrent } from "./price-monitoring.service";

describe("forEachConcurrent", () => {
  it("keeps active work within the configured concurrency", async () => {
    const items = Array.from({ length: 8 }, (_, index) => index);
    const processed: number[] = [];
    let active = 0;
    let maximumActive = 0;

    await forEachConcurrent(items, 2, async item => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      processed.push(item);
      active -= 1;
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(processed.sort((a, b) => a - b)).toEqual(items);
    expect(active).toBe(0);
  });

  it("does not invoke the worker for an empty collection", async () => {
    let calls = 0;

    await forEachConcurrent([], 4, async () => {
      calls += 1;
    });

    expect(calls).toBe(0);
  });
});
