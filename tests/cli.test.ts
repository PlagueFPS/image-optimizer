import sharp from "sharp";
import { Array as Arr, Effect, Schema, String as Str } from "effect";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";

const root = mkdtempSync(join(tmpdir(), "image-optimizer-test-"));

const source = join(root, "input");

mkdirSync(join(source, "nested"), { recursive: true });

copyFileSync(resolve("tests/fixtures/test.jpg"), join(source, "photo.jpg"));

copyFileSync(resolve("tests/fixtures/test2.png"), join(source, "nested", "second.png"));

const cli = resolve("dist/cli.mjs");

const run = (output: string, extra: string[] = [], input = source, answer = "y") =>
  spawnSync(
    process.execPath,
    [cli, "optimize", "--source", input, "--output", output, "--json", ...extra],
    { cwd: root, encoding: "utf8", input: answer, timeout: 10000 },
  );

afterAll(() => rmSync(root, { recursive: true, force: true }));

test.each(["webp", "avif", "jpeg", "png"])("encodes %s and preserves directories", (format) => {
  const output = join(root, format);
  const result = run(output, ["--format", format, "--width", "16", "--recursive"]);
  expect(result.stderr).toContain("Create it?");
  expect(result.status).toBe(0);
  expect(() =>
    Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(result.stdout)),
  ).not.toThrow();
  expect(existsSync(join(output, `photo.${format}`))).toBe(true);
  expect(existsSync(join(output, "nested", `second.${format}`))).toBe(true);
  expect(run(output, ["--format", format, "--recursive"]).stdout).toContain("skipped");

  return sharp(join(output, `photo.${format}`))
    .metadata()
    .then((metadata) => {
      expect(metadata.width).toBe(16);
      expect(metadata.format).toBe(format === "avif" ? "heif" : format);
      expect(metadata.exif).toBeUndefined();
    });
});

test("dry run writes nothing", () => {
  const output = join(root, "dry");
  const result = run(output, ["--dry-run"], source, "");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("planned");
  expect(result.stderr).toBe("");
  expect(existsSync(output)).toBe(false);
});

test("confirming creates missing output parents once and optimizes images", () => {
  const output = join(root, "confirmed", "output");
  const result = run(output, ["--recursive", "--width", "16"], source, "\r");
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("Create it?");

  const report = Effect.runSync(
    Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(result.stdout),
  );

  expect(report).toHaveLength(2);
  expect(existsSync(join(output, "photo.webp"))).toBe(true);
  expect(existsSync(join(output, "nested", "second.webp"))).toBe(true);
});

test("declining output creation cancels without writes", () => {
  const output = join(root, "declined", "output");
  const original = readFileSync(join(source, "photo.jpg"));
  const result = run(output, [], source, "n");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Optimization cancelled");
  expect(result.stdout).toBe("");
  expect(existsSync(join(root, "declined"))).toBe(false);
  expect(readFileSync(join(source, "photo.jpg"))).toEqual(original);
});

test.each(["--yes", "-y"])("%s creates missing output directories without prompting", (flag) => {
  const output = join(root, flag, "output");
  const result = run(output, [flag, "--width", "16"], source, "");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain('"optimized"');
  expect(existsSync(join(output, "photo.webp"))).toBe(true);

  const preview = join(root, flag, "preview");
  const dryRun = run(preview, [flag, "--dry-run"], source, "");
  expect(dryRun.status).toBe(0);
  expect(dryRun.stdout).toContain('"planned"');
  expect(existsSync(preview)).toBe(false);

  const overlap = join(source, "unsafe-output");
  const rejected = run(overlap, [flag], source, "");
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain("must not overlap");
  expect(existsSync(overlap)).toBe(false);
});

test("closed input does not create a missing output directory", () => {
  const output = join(root, "unanswered");
  expect(run(output, [], source, "").status).toBe(130);
  expect(existsSync(output)).toBe(false);
});

test("existing output directories do not prompt", () => {
  const output = join(root, "existing");
  mkdirSync(output);
  const result = run(output, ["--width", "16"], source, "");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain('"optimized"');
});

test("rejects overlap and invalid ranges before writing", () => {
  expect(run(join(source, "output")).status).not.toBe(0);

  for (const flag of ["--quality", "--concurrency", "--width", "--compression"]) {
    expect(run(join(root, "invalid"), [flag, "-1"]).status).not.toBe(0);
  }

  expect(existsSync(join(root, "invalid"))).toBe(false);
});

test("rejects collisions before writing", () => {
  const input = join(root, "collision");
  mkdirSync(input);
  copyFileSync(join(source, "photo.jpg"), join(input, "same.jpg"));
  copyFileSync(join(source, "photo.jpg"), join(input, "same.png"));
  const output = join(root, "collision-output");
  const result = run(output, ["--recursive"], input);

  expect(result.status).not.toBe(0);
  expect(result.stderr).not.toContain("Create it?");
  expect(existsSync(output)).toBe(false);
});

test.each([1, 12, 64, 96])("accepts explicit concurrency %i", (concurrency) => {
  const result = run(join(root, `concurrency-${concurrency}`), [
    "--yes",
    "--concurrency",
    String(concurrency),
    "--recursive",
    "--width",
    "16",
  ]);

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain('"optimized"');
  expect(existsSync(join(root, `concurrency-${concurrency}`, "photo.webp"))).toBe(true);
  expect(existsSync(join(root, `concurrency-${concurrency}`, "nested", "second.webp"))).toBe(true);
});

test.each([0, -1])("rejects concurrency %i before writing", (concurrency) => {
  const output = join(root, `invalid-concurrency-${concurrency}`);
  expect(run(output, ["--concurrency", String(concurrency)]).status).toBe(1);
  expect(existsSync(output)).toBe(false);
});

test("reports corrupt files and continues valid images", () => {
  const input = join(root, "corrupt");
  mkdirSync(input);
  writeFileSync(join(input, "broken.png"), "invalid");
  copyFileSync(join(source, "photo.jpg"), join(input, "valid.jpg"));
  const result = run(join(root, "corrupt-output"), [], input);
  expect(result.status).toBe(1);
  expect(() =>
    Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(result.stdout)),
  ).not.toThrow();
  expect(result.stdout).toContain('"failed"');
  expect(result.stdout).toContain('"optimized"');
});

test("skips symlink inputs and supports exclusions", () => {
  symlinkSync(join(source, "photo.jpg"), join(source, "linked.jpg"));
  const result = run(join(root, "excluded"), ["--exclude", "nested", "--recursive"]);
  expect(result.status).toBe(0);
  expect(result.stdout).not.toContain("linked.jpg");
  expect(result.stdout).not.toContain("second.png");
});

test("overwrite replaces an existing output only when requested", () => {
  const output = join(root, "overwrite");
  mkdirSync(output);
  const file = join(output, "photo.webp");
  writeFileSync(file, "keep");
  expect(run(output).status).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("keep");
  expect(run(output, ["--overwrite"]).status).toBe(0);
  expect(readFileSync(file).length).toBeGreaterThan(4);
});

test("packed npm binary runs outside the checkout", () => {
  const packed = Str.trim(
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root], {
      encoding: "utf8",
    }),
  );

  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  execFileSync("npm", ["install", "--no-audit", "--no-fund", join(root, packed)], {
    cwd: consumer,
    stdio: "pipe",
  });
  const binary = join(consumer, "node_modules", ".bin", "img");
  const help = execFileSync(binary, ["--help"], { cwd: consumer, encoding: "utf8" });
  expect(help).toContain("optimize");
  expect(
    execFileSync("npx", ["--no-install", "img", "--version"], {
      cwd: consumer,
      encoding: "utf8",
    }),
  ).toContain("0.1.0");

  const result = execFileSync(
    binary,
    ["optimize", "--source", source, "--output", join(root, "packed-output"), "--format", "png"],
    { cwd: consumer, encoding: "utf8", input: "y" },
  );

  expect(result).toContain("optimized");
});

test("rejects filesystem-root output", () => {
  const result = run(resolve("/"), ["--dry-run"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("must not overlap");
});

test("symlink output parents cannot create directories outside the output", () => {
  const input = join(root, "symlink-source");
  mkdirSync(join(input, "nested", "deeper"), { recursive: true });
  copyFileSync(join(source, "photo.jpg"), join(input, "nested", "deeper", "image.jpg"));
  const output = join(root, "symlink-output");
  const outside = join(root, "outside");
  mkdirSync(output);
  mkdirSync(outside);
  symlinkSync(outside, join(output, "nested"));
  expect(run(output, ["--recursive"], input).status).not.toBe(0);
  expect(existsSync(join(outside, "deeper"))).toBe(false);
});

test("dry-run defaults to non-recursive processing and writes nothing", () => {
  const output = join(root, "dry-run-command");

  const report = execFileSync(
    process.execPath,
    [cli, "optimize", "-s", source, "-o", output, "--dry-run", "--json"],
    { encoding: "utf8" },
  );

  expect(report).toContain("photo.jpg");
  expect(report).not.toContain("second.png");
  expect(existsSync(output)).toBe(false);
});

test("single file input resizes and converts while preserving the original", () => {
  const file = join(source, "photo.jpg");
  const original = readFileSync(file);
  const output = join(root, "single");
  const result = run(output, ["--width", "32", "--format", "avif"], file);
  expect(result.status).toBe(0);
  expect(readFileSync(file)).toEqual(original);

  return sharp(join(output, "photo.avif"))
    .metadata()
    .then((metadata) => {
      expect(metadata.width).toBe(32);
      expect(metadata.format).toBe("heif");
    });
});

test("single file cannot overwrite itself even with overwrite enabled", () => {
  const file = join(source, "nested", "second.png");
  const original = readFileSync(file);
  const result = run(join(source, "nested"), ["--format", "png", "--overwrite"], file);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("replace an original");
  expect(readFileSync(file)).toEqual(original);
});

test.each(["cover", "contain", "fill", "inside", "outside"])(
  "fit %s has documented dimensions",
  (fit) => {
    const output = join(root, `fit-${fit}`);

    const result = run(
      output,
      ["--width", "20", "--height", "20", "--fit", fit],
      join(source, "nested", "second.png"),
    );

    expect(result.status).toBe(0);

    return sharp(join(output, "second.webp"))
      .metadata()
      .then((metadata) => {
        if (fit === "inside") {
          expect(metadata.width).toBe(20);
          expect(metadata.height).toBeLessThan(20);
        } else if (fit === "outside") {
          expect(metadata.height).toBe(20);
          expect(metadata.width).toBeGreaterThan(20);
        } else {
          expect(metadata.width).toBe(20);
          expect(metadata.height).toBe(20);
        }
      });
  },
);

test("crop position changes which pixels are retained", () => {
  const file = join(root, "split.png");

  return sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .composite([
      {
        input: { create: { width: 20, height: 20, channels: 3, background: "blue" } },
        left: 20,
        top: 0,
      },
    ])
    .png()
    .toFile(file)
    .then(() => {
      for (const position of ["west", "east"]) {
        expect(
          run(
            join(root, position),
            [
              "--format",
              "png",
              "--width",
              "20",
              "--height",
              "20",
              "--fit",
              "cover",
              "--position",
              position,
            ],
            file,
          ).status,
        ).toBe(0);
      }

      return sharp(join(root, "west", "split.png"))
        .raw()
        .toBuffer();
    })
    .then((pixels) => {
      expect(pixels[0]).toBe(255);
      expect(pixels[2]).toBe(0);

      return sharp(join(root, "east", "split.png"))
        .raw()
        .toBuffer();
    })
    .then((pixels) => {
      expect(pixels[0]).toBe(0);
      expect(pixels[2]).toBe(255);
    });
});

test("enlargement requires explicit opt-in", () => {
  const file = join(source, "nested", "second.png");
  expect(run(join(root, "no-upscale"), ["--width", "1000"], file).status).toBe(0);
  expect(run(join(root, "upscale"), ["--width", "1000", "--upscale"], file).status).toBe(0);

  return sharp(join(root, "no-upscale", "second.webp"))
    .metadata()
    .then((metadata) => {
      expect(metadata.width).toBe(567);

      return sharp(join(root, "upscale", "second.webp")).metadata();
    })
    .then((metadata) => expect(metadata.width).toBe(1000));
});

test("metadata preservation is explicit", () => {
  const file = join(source, "photo.jpg");
  expect(run(join(root, "metadata"), ["--metadata", "--width", "16"], file).status).toBe(0);

  return sharp(join(root, "metadata", "photo.webp"))
    .metadata()
    .then((metadata) => expect(metadata.exif).toBeDefined());
});

test.each(["png", "webp", "avif"])("%s lossless output preserves decoded pixels", (format) => {
  const pixels = Buffer.alloc(32 * 32 * 3);

  for (let index = 0; index < pixels.length; index++)
    pixels[index] = (index * 37 + Math.floor(index / 3)) % 256;
  const file = join(root, `lossless-${format}.png`);

  return sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
    .png()
    .toFile(file)
    .then(() => {
      const output = join(root, `lossless-${format}`);
      expect(run(output, ["--format", format, "--lossless", "--effort", "0"], file).status).toBe(0);

      return sharp(join(output, `lossless-${format}.${format}`))
        .raw()
        .toBuffer();
    })
    .then((decoded) => expect(decoded).toEqual(pixels));
});

test("automation has exact exit codes and per-file reports", () => {
  expect(run(join(root, "exit-invalid"), ["--quality", "101"]).status).toBe(1);
  expect(run(join(root, "exit-missing"), [], join(root, "missing.jpg")).status).toBe(1);
  expect(run(join(root, "exit-unsupported"), [], resolve("tests/fixtures/test.txt")).status).toBe(
    1,
  );
  expect(run(join(root, "exit-jpeg"), ["--format", "jpeg", "--lossless"]).status).toBe(1);
  const empty = join(root, "empty");
  mkdirSync(empty);
  const result = run(join(root, "empty-output"), [], empty, "");
  expect(result.status).toBe(0);
  expect(Str.trim(result.stdout)).toBe("[]");
  expect(result.stderr).toBe("");
  expect(existsSync(join(root, "empty-output"))).toBe(false);
});

test("help explains file inputs, defaults, crop controls, safety, and automation", () => {
  const help = execFileSync(process.execPath, [cli, "optimize", "--help"], { encoding: "utf8" });

  for (const term of [
    "file or directory",
    "Default:",
    "--position",
    "cover crops",
    "--recursive",
    "Originals",
    "Exit 0",
    "--lossless",
    "75% of available CPUs",
    "libvips uses 1 thread per image",
    "--yes",
    "EXAMPLES",
  ])
    expect(help).toContain(term);
});

test("quality changes encoded output and effort accepts both documented limits", () => {
  const file = join(source, "photo.jpg");
  const low = join(root, "quality-low");
  const high = join(root, "quality-high");
  expect(run(low, ["--width", "64", "--quality", "20", "--effort", "0"], file).status).toBe(0);
  expect(run(high, ["--width", "64", "--quality", "95", "--effort", "6"], file).status).toBe(0);
  expect(readFileSync(join(low, "photo.webp"))).not.toEqual(readFileSync(join(high, "photo.webp")));
  expect(run(join(root, "invalid-effort"), ["--effort", "7"], file).status).toBe(1);
});

test("short aliases resize and convert while height stays long form", () => {
  const output = join(root, "aliases");

  const result = run(
    output,
    ["-f", "png", "-q", "75", "-w", "16", "--height", "16", "-e", "0", "--fit", "cover"],
    join(source, "photo.jpg"),
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"optimized"');

  return sharp(join(output, "photo.png"))
    .metadata()
    .then((metadata) => {
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(16);
      expect(metadata.height).toBe(16);
    });
});

test("recursion requires opt-in for optimization and dry runs", () => {
  const shallow = join(root, "shallow");
  expect(run(shallow, ["--width", "16"]).status).toBe(0);
  expect(existsSync(join(shallow, "photo.webp"))).toBe(true);
  expect(existsSync(join(shallow, "nested"))).toBe(false);
  const recursive = run(join(root, "recursive-preview"), ["--recursive", "--dry-run"]);
  expect(recursive.status).toBe(0);
  expect(recursive.stdout).toContain("second.png");
  expect(existsSync(join(root, "recursive-preview"))).toBe(false);
});

test("sizes create a source-sized output and distinct aspect-preserving widths", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const file = join(root, "sizes.png");
      yield* Effect.promise(() =>
        sharp({ create: { width: 120, height: 60, channels: 3, background: "red" } })
          .png()
          .toFile(file),
      );
      const original = readFileSync(file);
      const output = join(root, "sizes-output");
      const result = run(output, ["--yes", "--sizes", " 30, 60,30,120 ", "--format", "png"], file);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(file)).toEqual(original);

      const reports = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Array(Schema.Struct({ status: Schema.String, output: Schema.String })),
        ),
      )(result.stdout);

      expect(Arr.map(reports, (report) => report.status)).toEqual([
        "optimized",
        "optimized",
        "optimized",
        "optimized",
      ]);
      expect(Arr.map(reports, (report) => report.output)).toEqual([
        join(output, "sizes.png"),
        join(output, "sizes-30.png"),
        join(output, "sizes-60.png"),
        join(output, "sizes-120.png"),
      ]);

      for (const [name, width, height] of [
        ["sizes.png", 120, 60],
        ["sizes-30.png", 30, 15],
        ["sizes-60.png", 60, 30],
        ["sizes-120.png", 120, 60],
      ] as const) {
        const decoded = yield* Effect.promise(() =>
          sharp(join(output, name)).raw().toBuffer({ resolveWithObject: true }),
        );

        expect(decoded.info.width).toBe(width);
        expect(decoded.info.height).toBe(height);
      }
    }),
  ));

test.each(["", "0", "-1", "1.5", "NaN", "16,", ",16", "16,,32", "1e2", "0x10", "9007199254740992"])(
  "rejects invalid sizes %s before writing",
  (sizes) => {
    const output = join(root, `sizes-invalid-${sizes}`);
    const result = run(output, ["--sizes", sizes]);
    expect(result.status).toBe(1);
    expect(existsSync(output)).toBe(false);
  },
);

test.each(["--width", "--height"])("sizes reject %s before writing", (flag) => {
  const output = join(root, `sizes-conflict-${flag}`);
  const result = run(output, ["--sizes", "16", flag, "32"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("cannot be combined");
  expect(existsSync(output)).toBe(false);
});

test("oversized variants fail without clamping and upscale permits their exact width", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const file = join(source, "nested", "second.png");
      const output = join(root, "sizes-too-large");
      const result = run(output, ["--sizes", "16,1000"], file);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("exceeds source width");
      expect(existsSync(join(output, "second.webp"))).toBe(true);
      expect(existsSync(join(output, "second-16.webp"))).toBe(true);
      expect(existsSync(join(output, "second-1000.webp"))).toBe(false);
      const enlarged = join(root, "sizes-enlarged");
      expect(run(enlarged, ["--sizes", "1000", "--upscale"], file).status).toBe(0);

      const decoded = yield* Effect.promise(() =>
        sharp(join(enlarged, "second-1000.webp")).raw().toBuffer({ resolveWithObject: true }),
      );

      expect(decoded.info.width).toBe(1000);
    }),
  ));

test("sizes validate against auto-oriented width", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const file = join(root, "sizes-rotated.jpg");
      yield* Effect.promise(() =>
        sharp({ create: { width: 80, height: 40, channels: 3, background: "blue" } })
          .withMetadata({ orientation: 6 })
          .jpeg()
          .toFile(file),
      );
      const output = join(root, "sizes-rotated-output");
      const result = run(output, ["--sizes", "20,60"], file);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("exceeds source width 40");
      expect(existsSync(join(output, "sizes-rotated-60.webp"))).toBe(false);

      const decoded = yield* Effect.promise(() =>
        sharp(join(output, "sizes-rotated-20.webp")).raw().toBuffer({ resolveWithObject: true }),
      );

      expect(decoded.info.width).toBe(20);
      expect(decoded.info.height).toBe(40);
    }),
  ));

test("sizes dry runs list mirrored variants and reject oversize without writes", () => {
  const output = join(root, "sizes-preview");
  const result = run(output, ["--sizes", "16,32", "--recursive", "--dry-run"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(join(output, "photo-16.webp"));
  expect(result.stdout).toContain(join(output, "nested", "second-32.webp"));
  expect(existsSync(output)).toBe(false);

  const invalid = run(
    output,
    ["--sizes", "1000", "--dry-run"],
    join(source, "nested", "second.png"),
  );

  expect(invalid.status).toBe(1);
  expect(invalid.stdout).toContain("exceeds source width");
  expect(existsSync(output)).toBe(false);
});

test("sizes reject collisions between variant and source basenames before writing", () => {
  const input = join(root, "sizes-collision");
  mkdirSync(input);
  copyFileSync(join(source, "photo.jpg"), join(input, "photo.jpg"));
  copyFileSync(join(source, "photo.jpg"), join(input, "photo-16.jpg"));
  const output = join(root, "sizes-collision-output");
  const result = run(output, ["--sizes", "16"], input);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("same output");
  expect(existsSync(output)).toBe(false);
});

test("sizes preserve skip and overwrite behavior for each output", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const output = join(root, "sizes-overwrite");
      mkdirSync(output);
      const variant = join(output, "photo-16.webp");
      writeFileSync(variant, "keep");
      expect(run(output, ["--sizes", "16"]).status).toBe(0);
      expect(readFileSync(variant, "utf8")).toBe("keep");
      expect(existsSync(join(output, "photo.webp"))).toBe(true);
      expect(run(output, ["--sizes", "16", "--overwrite"]).status).toBe(0);

      const decoded = yield* Effect.promise(() =>
        sharp(variant).raw().toBuffer({ resolveWithObject: true }),
      );

      expect(decoded.info.width).toBe(16);
    }),
  ));

test("sizes continue valid images when another source is corrupt", () => {
  const input = join(root, "sizes-corrupt");
  mkdirSync(input);
  writeFileSync(join(input, "broken.png"), "invalid");
  copyFileSync(join(source, "photo.jpg"), join(input, "valid.jpg"));
  const output = join(root, "sizes-corrupt-output");
  const result = run(output, ["--sizes", "16"], input);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"failed"');
  expect(existsSync(join(output, "valid.webp"))).toBe(true);
  expect(existsSync(join(output, "valid-16.webp"))).toBe(true);
});

const Metrics = Schema.Struct({
  inputBytes: Schema.Finite,
  outputBytes: Schema.Finite,
  savedBytes: Schema.Finite,
  reductionPercent: Schema.Finite,
});

const CompletedReport = Schema.Struct({
  ...Metrics.fields,
  source: Schema.String,
  output: Schema.String,
  bytes: Schema.Finite,
});

const SummaryReport = Schema.fromJsonString(
  Schema.Struct({
    results: Schema.Array(Schema.Unknown),
    summary: Schema.Struct({
      ...Metrics.fields,
      optimized: Schema.Finite,
      skipped: Schema.Finite,
      planned: Schema.Finite,
      failed: Schema.Finite,
    }),
  }),
);

const decodeSummary = (text: string) => Effect.runSync(Schema.decodeEffect(SummaryReport)(text));

const expectMetrics = (metrics: typeof Metrics.Type, inputBytes: number, outputBytes: number) => {
  expect(metrics.inputBytes).toBe(inputBytes);
  expect(metrics.outputBytes).toBe(outputBytes);
  expect(metrics.savedBytes).toBe(inputBytes - outputBytes);
  expect(metrics.reductionPercent).toBeCloseTo(
    inputBytes === 0 ? 0 : ((inputBytes - outputBytes) / inputBytes) * 100,
  );
};

test("JSON keeps its array contract and reports each responsive output against its source", () => {
  const output = join(root, "report-sizes");
  const input = join(source, "photo.jpg");
  const before = readFileSync(input);
  const result = run(output, ["--sizes", "16,32"], input);
  expect(result.status).toBe(0);

  const reports = Effect.runSync(
    Schema.decodeEffect(Schema.fromJsonString(Schema.Array(CompletedReport)))(result.stdout),
  );

  expect(reports).toHaveLength(3);

  for (const report of reports) {
    expectMetrics(report, statSync(input).size, statSync(report.output).size);
    expect(report.bytes).toBe(report.outputBytes);
  }

  expect(readFileSync(input)).toEqual(before);
  const skipped = run(output, ["--sizes", "16,32", "--summary-json"], input);
  expect(skipped.status).toBe(0);
  const skippedSummary = decodeSummary(skipped.stdout).summary;
  expect(skippedSummary).toMatchObject({ optimized: 0, skipped: 3, planned: 0, failed: 0 });
  expectMetrics(skippedSummary, 0, 0);
  const aggregateOutput = join(root, "report-sizes-summary");
  const aggregate = run(aggregateOutput, ["--sizes", "16,32", "--summary-json"], input);
  expect(aggregate.status).toBe(0);
  const { summary } = decodeSummary(aggregate.stdout);
  expect(summary.optimized).toBe(3);
  expectMetrics(
    summary,
    statSync(input).size * 3,
    Arr.reduce(
      ["photo.webp", "photo-16.webp", "photo-32.webp"],
      0,
      (total, file) => total + statSync(join(aggregateOutput, file)).size,
    ),
  );
});

test("summary counts only completed writes among success, skip, and failure", () => {
  const input = join(root, "report-mixed-input");
  const output = join(root, "report-mixed-output");
  mkdirSync(input);
  mkdirSync(output);
  copyFileSync(join(source, "photo.jpg"), join(input, "valid.jpg"));
  copyFileSync(join(source, "photo.jpg"), join(input, "skip.jpg"));
  writeFileSync(join(input, "broken.png"), "invalid");
  writeFileSync(join(input, "empty.png"), "");
  writeFileSync(join(output, "skip.webp"), "keep");
  const result = run(output, ["--summary-json"], input);
  expect(result.status).toBe(1);
  const report = decodeSummary(result.stdout);
  expect(report.summary).toMatchObject({ optimized: 1, skipped: 1, planned: 0, failed: 2 });
  expectMetrics(
    report.summary,
    statSync(join(input, "valid.jpg")).size,
    statSync(join(output, "valid.webp")).size,
  );
  expect(readFileSync(join(output, "skip.webp"), "utf8")).toBe("keep");

  const rows = Effect.runSync(
    Schema.decodeEffect(
      Schema.fromJsonString(Schema.Struct({ results: Schema.Array(Schema.Unknown) })),
    )(result.stdout),
  ).results;

  for (const row of rows.slice(0, 3)) expect(row).not.toHaveProperty("savedBytes");
});

test("empty and dry-run reports have zero totals and no invented savings", () => {
  const empty = join(root, "report-empty");
  mkdirSync(empty);

  for (const [name, input, extra, planned] of [
    ["empty", empty, [], 0],
    ["dry", source, ["--dry-run", "--sizes", "16,32"], 3],
  ] satisfies Array<[string, string, string[], number]>) {
    const output = join(root, `report-zero-${name}`);
    const result = run(output, ["--summary-json", ...extra], input);
    expect(result.status).toBe(0);
    const report = decodeSummary(result.stdout);
    expect(report.summary).toMatchObject({ optimized: 0, skipped: 0, failed: 0, planned });
    expectMetrics(report.summary, 0, 0);
    expect(result.stdout).not.toContain('"savedBytes":null');
    expect(existsSync(output)).toBe(false);

    for (const row of report.results) expect(row).not.toHaveProperty("savedBytes");
  }
});

test("growth is negative savings in JSON and human reports", () => {
  const input = join(source, "photo.jpg");
  const output = join(root, "report-growth");
  const result = run(output, ["--format", "png", "--summary-json"], input);
  expect(result.status).toBe(0);
  const { summary } = decodeSummary(result.stdout);
  expectMetrics(summary, statSync(input).size, statSync(join(output, "photo.png")).size);
  expect(summary.savedBytes).toBeLessThan(0);
  expect(summary.reductionPercent).toBeLessThan(0);

  const human = spawnSync(
    process.execPath,
    [cli, "optimize", "--yes", "-s", input, "-o", join(root, "report-human"), "-f", "png"],
    { encoding: "utf8" },
  );

  expect(human.status).toBe(0);
  expect(human.stdout).toContain(
    `${summary.inputBytes} input bytes -> ${summary.outputBytes} output bytes, ${summary.savedBytes} saved bytes`,
  );
  expect(human.stdout).toContain("Summary: 1 optimized, 0 skipped, 0 planned, 0 failed");
  expect(human.stdout).toContain("Completed writes only; input counted per output.");
});

test("a failed output replacement contributes no savings", () => {
  const input = join(root, "report-write-failure-input");
  const output = join(root, "report-write-failure-output");
  mkdirSync(input);
  mkdirSync(join(output, "blocked.webp"), { recursive: true });
  copyFileSync(join(source, "photo.jpg"), join(input, "blocked.jpg"));
  copyFileSync(join(source, "photo.jpg"), join(input, "valid.jpg"));
  const result = run(output, ["--overwrite", "--summary-json"], input);
  expect(result.status).toBe(1);
  const report = decodeSummary(result.stdout);
  expect(report.summary).toMatchObject({ optimized: 1, failed: 1, skipped: 0, planned: 0 });
  expectMetrics(
    report.summary,
    statSync(join(input, "valid.jpg")).size,
    statSync(join(output, "valid.webp")).size,
  );
  expect(statSync(join(output, "blocked.webp")).isDirectory()).toBe(true);
});
