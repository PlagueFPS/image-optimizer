import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: { entry: ["src/cli.ts"], format: ["esm"], dts: false, clean: true },
  test: { testTimeout: 30000 },
});
