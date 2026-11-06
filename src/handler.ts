import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { Prompt } from "effect/cli";
import sharp from "sharp";
import { validateEncoder } from "./encoder.ts";
import { Config, OptimizationError } from "./options.ts";
import {
  optimize,
  plan,
  RelocationResult,
  ReportJson,
  summarize,
  type OptimizationResult,
  type SizeMetrics,
} from "./optimizer.ts";

sharp.concurrency(1);

const formatMetrics = (metrics: SizeMetrics) =>
  `${metrics.inputBytes} input bytes -> ${metrics.outputBytes} output bytes, ${metrics.savedBytes} saved bytes (${metrics.reductionPercent.toFixed(2)}% reduction)`;

const toReport = (result: OptimizationResult) => ({
  ...result,
  archive: Option.getOrUndefined(result.archive),
  relocation: result.relocation.pipe(
    Option.map(
      RelocationResult.$match({
        Moved: ({ destination }) => ({ status: "moved" as const, destination }),
        Failed: ({ destination, error }) => ({ status: "failed" as const, destination, error }),
      }),
    ),
    Option.getOrUndefined,
  ),
});

export const run = Effect.fn("main")(function* (args: Config & { readonly summaryJson: boolean }) {
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

  const outcomes = yield* optimize(config, jobs);
  const results = Arr.map(outcomes, toReport);
  const summary = summarize(outcomes);

  if (config.json || args.summaryJson) {
    const report = yield* Schema.encodeEffect(ReportJson)(
      args.summaryJson ? { results, summary } : results,
    );

    yield* Console.log(report);
  } else {
    yield* Effect.forEach(results, (result) =>
      Console.log(
        `${result.status}: ${result.source} -> ${result.output}${result.status === "optimized" ? ` (${formatMetrics(result)})` : ""}${result.archive === undefined ? "" : ` (archive ${result.relocation?.status ?? "not moved"}: ${result.archive}${result.relocation?.status === "failed" ? `, ${result.relocation.error}` : ""})`}${"error" in result ? ` (${result.error})` : ""}`,
      ),
    );
    yield* Console.log(
      `Summary: ${summary.optimized} optimized, ${summary.skipped} skipped, ${summary.planned} planned, ${summary.failed} failed; ${formatMetrics(summary)}. Completed writes only; input counted per output.`,
    );
  }

  if (
    Arr.some(
      results,
      (result) => result.status === "failed" || result.relocation?.status === "failed",
    )
  ) {
    return yield* OptimizationError.make({
      message: "One or more images failed. See the report for details.",
    });
  }
});
