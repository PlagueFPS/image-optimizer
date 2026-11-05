import sharp from "sharp";
import { Array as Arr, Effect, Schema, String as Str } from "effect";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, expect, test } from "vite-plus/test";

const encode = (value: Schema.Json) =>
  Effect.runSync(Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(value));

const root = mkdtempSync(join(tmpdir(), "image-benchmark-test-"));

const benchmark = resolve("tools/bench/webp.ts");

const helper = join(root, "encode.cjs");

writeFileSync(
  helper,
  `const sharp = require(${encode(resolve("node_modules/sharp"))});
const encode = JSON.stringify;
const fs = require('node:fs/promises');
const path = require('node:path');
const argv = process.argv.slice(2);
const value = flag => argv[argv.indexOf(flag) + 1];
const source = value('-s');
const output = value('-o');
(async () => {
  await fs.writeFile(path.join(output, 'environment.json'), encode({
    pool: process.env.UV_THREADPOOL_SIZE ?? null,
    cache: process.env.NODE_COMPILE_CACHE ?? null,
    disabled: process.env.NODE_DISABLE_COMPILE_CACHE ?? null,
    removed: process.env.BENCHMARK_TEST_REMOVE ?? null
  }));
  const quality = Number(process.env.BENCHMARK_TEST_QUALITY ?? '80');
  await sharp(source).rotate().webp({ quality, effort: 4 }).toFile(path.join(output, path.parse(source).name + '.webp'));
  const mode = process.env.BENCHMARK_TEST_MODE;
  console.log(encode({ summary: { optimized: mode === 'counts' ? 0 : 1, failed: 0, skipped: 0 } }));
  if (mode === 'exit') {
    process.stderr.write('intentional child failure');
    process.exitCode = 7;
  }
})().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });`,
);

const Summary = Schema.Array(
  Schema.Struct({
    case: Schema.String,
    variant: Schema.String,
    n: Schema.Int,
    optimized: Schema.Int,
    failures: Schema.Int,
  }),
);

const Row = Schema.Struct({
  variant: Schema.String,
  prime: Schema.Boolean,
  optimized: Schema.Int,
  failures: Schema.Int,
  cpu_seconds: Schema.Null,
  output_bytes: Schema.Finite,
  outputs: Schema.Array(
    Schema.Struct({
      bytes: Schema.Finite,
      width: Schema.Finite,
      height: Schema.Finite,
      alphaError: Schema.Finite,
      sha256: Schema.String,
    }),
  ),
});

const Environment = Schema.Struct({
  pool: Schema.NullOr(Schema.String),
  cache: Schema.NullOr(Schema.String),
  disabled: Schema.NullOr(Schema.String),
  removed: Schema.NullOr(Schema.String),
});

const read = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  file: string,
) => Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(schema))(readFileSync(file, "utf8")));

const run = (config: string, name: string, launcher = benchmark) => {
  const file = join(root, `${name}.json`);
  writeFileSync(file, config);

  const output = join(root, name);

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", launcher, file, "--output", output],
    { cwd: resolve("."), encoding: "utf8", timeout: 25000 },
  );

  return { output, result };
};

const lines = (file: string) =>
  Arr.map(Str.split("\n")(Str.trim(readFileSync(file, "utf8"))), (line) =>
    Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(Row))(line)),
  );

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("benchmark excludes cache priming and preserves output and environment contracts", () =>
  Effect.gen(function* () {
    const launcher = join(root, "inherited-environment.cjs");
    writeFileSync(
      launcher,
      `process.env.UV_THREADPOOL_SIZE = '2';
process.env.NODE_COMPILE_CACHE = ${encode(join(root, "inherited-cache"))};
process.env.NODE_DISABLE_COMPILE_CACHE = '1';
process.env.BENCHMARK_TEST_REMOVE = 'inherited';
process.argv[1] = ${encode(benchmark)};
import(${encode(pathToFileURL(benchmark).href)}).catch(error => { console.error(error); process.exitCode = 1; });`,
    );

    const { output, result } = run(
      encode({
        cases: ["small"],
        rounds: 1,
        variants: [
          { name: "warm", command: [process.execPath, helper], cache: "warm" },
          {
            name: "cold",
            command: [process.execPath, helper],
            cache: "cold",
            env: { UV_THREADPOOL_SIZE: "3", BENCHMARK_TEST_REMOVE: null },
          },
        ],
      }),
      "cache-and-environment",
      launcher,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(read(Summary, join(output, "summary.json"))).toEqual([
      { case: "small", variant: "warm", n: 1, optimized: 1, failures: 0 },
      { case: "small", variant: "cold", n: 1, optimized: 1, failures: 0 },
    ]);

    const rows = read(Schema.Array(Row), join(output, "runs.json"));
    const journal = lines(join(output, "runs.jsonl"));

    expect(rows).toHaveLength(2);
    expect(Arr.every(rows, (row) => !row.prime && row.cpu_seconds === null)).toBe(true);
    expect(journal).toHaveLength(3);
    expect(Arr.filter(journal, (row) => row.prime)).toHaveLength(1);
    expect(Arr.map(rows, (row) => row.outputs)).toEqual([rows[0]?.outputs, rows[0]?.outputs]);

    for (const name of ["warm", "cold"]) {
      const directory = join(output, `small-${name}-0`);
      const image = join(directory, "test2.webp");

      const decoded = yield* Effect.promise(() =>
        sharp(image).raw().toBuffer({ resolveWithObject: true }),
      );

      expect(decoded.info.width).toBe(567);
      expect(decoded.info.height).toBe(324);
      expect(decoded.data.length).toBeGreaterThan(0);

      const bytes = readFileSync(image);

      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variant: name,
            output_bytes: bytes.length,
            outputs: [
              expect.objectContaining({
                bytes: bytes.length,
                width: 567,
                height: 324,
                alphaError: 0,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              }),
            ],
          }),
        ]),
      );

      const environment = read(Environment, join(directory, "environment.json"));

      expect(environment.pool).toBe(name === "warm" ? null : "3");
      expect(environment.disabled).toBeNull();
      expect(environment.removed).toBe(name === "warm" ? "inherited" : null);
      expect(environment.cache).toBe(
        join(output, name === "warm" ? "warm-cache-warm" : "cold-cache-small-cold-0"),
      );
    }
  }).pipe(Effect.runPromise));

test("benchmark rejects an existing output tree without modifying it", () => {
  const output = join(root, "existing");
  mkdirSync(output);
  writeFileSync(join(output, "sentinel.txt"), "keep me");

  const { result } = run(
    encode({ cases: ["help"], rounds: 1, variants: [{ name: "cli" }] }),
    "existing",
  );

  expect(result.status).not.toBe(0);
  expect(readdirSync(output)).toEqual(["sentinel.txt"]);
  expect(readFileSync(join(output, "sentinel.txt"), "utf8")).toBe("keep me");
});

test("benchmark creates missing ancestors for a fresh output tree", () => {
  const file = join(root, "nested-output.json");
  const output = join(root, "missing-parent", "nested", "results");
  writeFileSync(file, encode({ cases: ["help"], rounds: 1, variants: [{ name: "cli" }] }));

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", benchmark, file, "--output", output],
    { cwd: resolve("."), encoding: "utf8", timeout: 25000 },
  );

  expect(result.status, result.stderr).toBe(0);
  expect(read(Summary, join(output, "summary.json"))).toEqual([
    { case: "help", variant: "cli", n: 1, optimized: 0, failures: 0 },
  ]);
});

test.each(["exit", "counts"])(
  "benchmark records a child %s failure without a success summary",
  (mode) => {
    const { output, result } = run(
      encode({
        cases: ["small"],
        rounds: 1,
        variants: [
          { name: "good", command: [process.execPath, helper] },
          {
            name: "bad",
            command: [process.execPath, helper],
            env: { BENCHMARK_TEST_MODE: mode },
          },
        ],
      }),
      `failure-${mode}`,
    );

    expect(result.status).not.toBe(0);
    expect(Str.trim(readFileSync(join(output, "failure.txt"), "utf8"))).not.toBe("");
    expect(existsSync(join(output, "summary.json"))).toBe(false);
    expect(existsSync(join(output, "runs.json"))).toBe(false);
    expect(lines(join(output, "runs.jsonl"))).toHaveLength(1);
  },
);

test("benchmark rejects different bytes from otherwise valid image variants", () => {
  const { output, result } = run(
    encode({
      cases: ["small"],
      rounds: 1,
      variants: [
        { name: "quality80", command: [process.execPath, helper] },
        {
          name: "quality90",
          command: [process.execPath, helper],
          env: { BENCHMARK_TEST_QUALITY: "90" },
        },
      ],
    }),
    "different-output",
  );

  expect(result.status).not.toBe(0);
  expect(existsSync(join(output, "summary.json"))).toBe(false);
  expect(Str.trim(readFileSync(join(output, "failure.txt"), "utf8"))).not.toBe("");
  expect(lines(join(output, "runs.jsonl"))).toHaveLength(1);
});
