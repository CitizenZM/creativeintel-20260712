import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // Manual operator experiments fetch real media / render local fixtures.
    // Opt in explicitly; they are not isolated unit tests.
    exclude: process.env.RUN_OPERATOR_TESTS === "1" ? [] : ["src/zz-ops/**"],
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 30_000,
    maxWorkers: 4,
  },
});
