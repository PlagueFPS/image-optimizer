#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Path,
  Schema,
  Stdio,
  Stream,
  String as Str,
  Terminal,
} from "effect";
import { Command, Flag, Prompt } from "effect/cli";
import { availableParallelism } from "node:os";
import sharp from "sharp";
import { validateEncoder } from "./encoder.ts";
import { defaultConcurrency } from "./concurrency.ts";
import { Config, Formats, Positions, OptimizationError } from "./options.ts";
import { optimize, plan, ReportJson, summarize, type SizeMetrics } from "./optimizer.ts";

const concurrency = defaultConcurrency(availableParallelism());

sharp.concurrency(1);

const flags = {
  source: Flag.String("source").pipe(
    Flag.withAlias("s"),
    Flag.withDefault("."),
    Flag.withDescription(
      "Source image file or directory. Default: current directory. Symlinks are not followed.",
    ),
  ),
  output: Flag.String("output").pipe(
    Flag.withAlias("o"),
    Flag.withDescription(
      "Required output directory. Prompts before creating it if missing. Mirrors directory inputs and preserves originals.",
    ),
  ),
  format: Flag.Literals("format", Formats).pipe(
    Flag.withAlias("f"),
    Flag.withDefault("webp"),
    Flag.withDescription(
      "Output format. Default: webp. Supports WebP, AVIF, JPEG, PNG, GIF, and TIFF. SVG/raw output is not supported.",
    ),
  ),
  quality: Flag.Int("quality").pipe(
    Flag.withAlias("q"),
    Flag.withDefault(80),
    Flag.withDescription(
      "WebP/AVIF/JPEG/TIFF quality, 1 to 100. Default: 80. Ignored for PNG/GIF.",
    ),
  ),
  effort: Flag.Int("effort").pipe(
    Flag.withAlias("e"),
    Flag.withDefault(4),
    Flag.withDescription(
      "WebP/AVIF encoder effort, 0 to 6. Default: 4. Ignored for other formats.",
    ),
  ),
  width: Flag.Int("width").pipe(
    Flag.withAlias("w"),
    Flag.withDefault(0),
    Flag.withDescription(
      "Resize width in pixels. Default: 0, unconstrained. Fit determines cropping.",
    ),
  ),
  height: Flag.Int("height").pipe(
    Flag.withDefault(0),
    Flag.withDescription(
      "Resize height in pixels. Default: 0, unconstrained. Fit determines cropping.",
    ),
  ),
  sizes: Flag.String("sizes").pipe(
    Flag.withSchema(Schema.String.check(Schema.isPattern(/^\s*\d+\s*(,\s*\d+\s*)*$/))),
    Flag.map((value) => Arr.dedupe(Arr.map(Str.split(",")(value), Number))),
    Flag.withSchema(Schema.Array(Schema.Int.check(Schema.isGreaterThan(0)))),
    Flag.withDefault([]),
    Flag.withDescription(
      "Additional widths in pixels, comma-separated. Keeps the source-sized output and creates name-WIDTH files. Cannot combine with --width or --height. Larger widths require --upscale.",
    ),
  ),
  concurrency: Flag.Int("concurrency").pipe(
    Flag.withDefault(concurrency),
    Flag.withDescription(
      `Concurrent file workflows, minimum 1. Default: ${concurrency} (75% of available CPUs, rounded down, min 1). libvips uses 1 thread per image.`,
    ),
  ),
  recursive: Flag.Boolean("recursive").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Opt into processing subdirectories. Default: false."),
  ),
  overwrite: Flag.Boolean("overwrite").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Replace existing outputs. Default: skip. Originals are always protected.",
    ),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Report planned destinations without writes. Default: false."),
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDefault(false),
    Flag.withDescription("Create a missing output directory without prompting. Default: false."),
  ),
  lossless: Flag.Boolean("lossless").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Lossless WebP/AVIF/TIFF encoding. Default: false. PNG is always lossless; JPEG/GIF reject this flag.",
    ),
  ),
  metadata: Flag.Boolean("metadata").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Keep source metadata. Default strips metadata."),
  ),
  upscale: Flag.Boolean("upscale").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Allow image enlargement. Default: false."),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Emit per-file JSON on stdout; errors use stderr. Exit 0 on success, 1 on failure.",
    ),
  ),
  summaryJson: Flag.Boolean("summary-json").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Emit a JSON object with results and completed-write summary. Overrides --json.",
    ),
  ),
  exclude: Flag.String("exclude").pipe(
    Flag.atLeast(0),
    Flag.withDescription("Exclude a relative path prefix. Repeatable."),
  ),
  fit: Flag.Literals("fit", ["inside", "contain", "cover", "fill", "outside"]).pipe(
    Flag.withDefault("inside"),
    Flag.withDescription(
      "Default: inside, preserve aspect within bounds. cover crops; contain pads; fill stretches; outside covers bounds without cropping.",
    ),
  ),
  position: Flag.Literals("position", Positions).pipe(
    Flag.withDefault("centre"),
    Flag.withDescription(
      "Crop anchor for cover, or padding alignment for contain. Default: centre. entropy/attention are smart cover crops.",
    ),
  ),
  background: Flag.String("background").pipe(
    Flag.withDefault("#ffffff"),
    Flag.withDescription("Contain/flatten background color. Default: #ffffff."),
  ),
  flatten: Flag.Boolean("flatten").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Remove transparency using the background color."),
  ),
  compression: Flag.Int("compression").pipe(
    Flag.withDefault(9),
    Flag.withDescription("PNG lossless compression level, 0 to 9. Default: 9."),
  ),
};

const formatMetrics = (metrics: SizeMetrics) =>
  `${metrics.inputBytes} input bytes -> ${metrics.outputBytes} output bytes, ${metrics.savedBytes} saved bytes (${metrics.reductionPercent.toFixed(2)}% reduction)`;

const run = Effect.fn("main")(function* (args: Config & { readonly summaryJson: boolean }) {
  const config = yield* Schema.decodeEffect(Config)(args);

  if (config.sizes.length > 0 && (config.width > 0 || config.height > 0)) {
    return yield* OptimizationError.make({
      message: "--sizes cannot be combined with --width or --height.",
    });
  }

  yield* validateEncoder(config);

  const jobs = yield* plan(config);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const output = path.resolve(config.output);

  if (!config.dryRun && jobs.length > 0 && !(yield* fs.exists(output))) {
    if (!config.yes) {
      const terminal = yield* Terminal.Terminal;
      const stdio = yield* Stdio.Stdio;

      const confirmed = yield* Prompt.run(
        Prompt.Confirm({
          message: `Output directory does not exist: ${output}. Create it?`,
          initial: true,
        }),
      ).pipe(
        Effect.provideService(
          Terminal.Terminal,
          Terminal.make({
            ...terminal,
            display: (text) =>
              Stream.make(text).pipe(Stream.run(stdio.stderr({ endOnDone: false }))),
          }),
        ),
      );

      if (!confirmed) {
        return yield* OptimizationError.make({
          message: `Output directory was not created: ${output}. Optimization cancelled.`,
        });
      }
    }
  }

  const results = yield* optimize(config, jobs);

  const summary = summarize(results);

  if (config.json || args.summaryJson) {
    const report = yield* Schema.encodeEffect(ReportJson)(
      args.summaryJson ? { results, summary } : results,
    );

    yield* Console.log(report);
  } else {
    yield* Effect.forEach(results, (result) =>
      Console.log(
        `${result.status}: ${result.source} -> ${result.output}${result.status === "optimized" ? ` (${formatMetrics(result)})` : ""}${"error" in result ? ` (${result.error})` : ""}`,
      ),
    );
    yield* Console.log(
      `Summary: ${summary.optimized} optimized, ${summary.skipped} skipped, ${summary.planned} planned, ${summary.failed} failed; ${formatMetrics(summary)}. Completed writes only; input counted per output.`,
    );
  }

  if (Arr.some(results, (result) => result.status === "failed")) {
    return yield* OptimizationError.make({
      message: "One or more images failed. See the report for details.",
    });
  }
});

const command = Command.make("img").pipe(
  Command.withDescription(
    "Resize and convert images safely with Effect and Node.js. Use optimize --help for controls and --dry-run to preview without writes. Requires Node.js 22.12+.",
  ),
  Command.withExamples([
    {
      command: "img optimize -s photo.jpg -o ./optimized --width 1280",
      description: "Optimize a file. Add --recursive to process subdirectories.",
    },
  ]),
  Command.withSubcommands([
    Command.make("optimize", flags, run).pipe(
      Command.withDescription(
        "Resize and convert an image file or directory. Preserves originals and mirrors subdirectories. Exit 0 on success or skips; exit 1 on invalid input, planning errors, or any failed file.",
      ),
      Command.withExamples([
        {
          command: "img optimize -s photo.jpg -o ./optimized --format avif --width 1280",
          description: "Resize and convert one file.",
        },
        {
          command: "img optimize -s input.png -o ./optimized -f webp --sizes 384,868,1200",
          description: "Optimize the source and create additional aspect-preserving widths.",
        },
        {
          command:
            "img optimize -s ./assets -o ../optimized --recursive --width 400 --height 400 --fit cover --position attention --json",
          description: "Recursively create square crops and report JSON.",
        },
      ]),
    ),
  ]),
);

Command.run(command, { version: "0.1.0" }).pipe(
  Effect.tapError((error) => Console.error(String(error))),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
