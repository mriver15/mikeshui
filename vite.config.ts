import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    // world-generation tests build dozens of chunks across seeds; on a
    // cold, shared CI runner that can take several times longer than locally
    testTimeout: 30_000,
  },
});
