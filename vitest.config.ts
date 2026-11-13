import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The dashboard's tests cover its pure helpers, so they run here in Node with the rest.
    include: ["packages/**/*.test.ts", "apps/server/**/*.test.ts", "apps/web/src/**/*.test.ts", "evals/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
  },
});
