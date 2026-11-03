import { recommended, effectNative, style } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    extends: [recommended, effectNative, style],
    options: { denyWarnings: true, typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["tests/**/*.ts"],
        rules: { "effecttsgo/node-builtin-import": "off" },
      },
    ],
  },
  fmt: {},
  pack: { entry: ["src/cli.ts"], format: ["esm"], dts: false, clean: true },
  test: { testTimeout: 30000 },
});
