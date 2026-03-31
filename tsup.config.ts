import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["index.ts", "src/configure-cli.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
  splitting: false,
  treeshake: true,
})
