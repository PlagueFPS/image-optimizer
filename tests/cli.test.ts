import sharp from "sharp";
import { Effect, Schema, String as Str } from "effect";
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

const run = (output: string, extra: string[] = [], input = source) =>
  spawnSync(
    process.execPath,
    [cli, "optimize", "--source", input, "--output", output, "--json", ...extra],
    { cwd: root, encoding: "utf8" },
  );

afterAll(() => rmSync(root, { recursive: true, force: true }));

test.each(["webp", "avif", "jpeg", "png"])("encodes %s and preserves directories", (format) => {
  const output = join(root, format);
  const result = run(output, ["--format", format, "--width", "16", "--recursive"]);
  expect(result.stderr).toBe("");
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
  expect(run(output, ["--dry-run"]).stdout).toContain("planned");
  expect(existsSync(output)).toBe(false);
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
  expect(run(output, ["--recursive"], input).status).not.toBe(0);
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
  const binary = join(consumer, "node_modules", ".bin", "image-optimizer");
  const help = execFileSync(binary, ["--help"], { cwd: consumer, encoding: "utf8" });
  expect(help).toContain("optimize");
  expect(
    execFileSync("npx", ["--no-install", "image-optimizer", "--version"], {
      cwd: consumer,
      encoding: "utf8",
    }),
  ).toContain("0.1.0");

  const result = execFileSync(
    binary,
    ["optimize", "--source", source, "--output", join(root, "packed-output"), "--format", "png"],
    { cwd: consumer, encoding: "utf8" },
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
  const result = run(join(root, "empty-output"), [], empty);
  expect(result.status).toBe(0);
  expect(Str.trim(result.stdout)).toBe("[]");
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
