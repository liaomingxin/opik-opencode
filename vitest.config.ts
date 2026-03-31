import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.e2e.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "index.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.e2e.test.ts"],
    },
    testTimeout: 10_000,
  },
})
