#!/usr/bin/env -S node --experimental-strip-types
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Cause,
  Clock,
  Console,
  Effect,
  FileSystem,
  HashMap,
  Option,
  Order,
  Path,
  Record as Rec,
  Schema,
  Stream,
  String as Str,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Dimensions, type Job, Output } from "./image-protocol.ts";

const CaseName = Schema.Literals([
  "small",
  "photo",
  "resize",
  "batch",
  "sizes",
  "small-sizes",
  "help",
  "version",
]);

type CaseName = typeof CaseName.Type;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

const Variant = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/)),
  kind: Schema.Literals(["img", "control", "cwebp", "magick"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("img")),
  ),
  command: Schema.optionalKey(Schema.NonEmptyArray(Schema.String.check(Schema.isMinLength(1)))),
  workers: PositiveInt.pipe(Schema.withDecodingDefaultKey(Effect.succeed(12))),
  cache: Schema.Literals(["disabled", "cold", "warm"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("disabled")),
  ),
  flags: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  env: Schema.Record(Schema.String, Schema.NullOr(Schema.String)).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});

const Config = Schema.Struct({
  cases: Schema.NonEmptyArray(CaseName),
  variants: Schema.NonEmptyArray(Variant),
  rounds: PositiveInt.pipe(Schema.withDecodingDefaultKey(Effect.succeed(5))),
});

type Variant = typeof Variant.Type;

const Json = Schema.fromJsonString(Schema.Unknown);

const Report = Schema.fromJsonString(
  Schema.Struct({
    summary: Schema.Struct({ optimized: Schema.Int, failed: Schema.Int, skipped: Schema.Int }),
  }),
);

class BenchmarkError extends Schema.TaggedError<
  BenchmarkError,
  { readonly brand: unique symbol }
>()("BenchmarkError", { message: Schema.String }) {}

const check = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(BenchmarkError.make({ message }));

type Workload =
  | { readonly kind: "info"; readonly name: "help" | "version" }
  | {
      readonly kind: "image";
      readonly name: Exclude<CaseName, "help" | "version">;
      readonly source: string;
      readonly widths: readonly number[];
    };

type Row = {
  readonly case: CaseName;
  readonly variant: string;
  readonly round: number | "prime";
  readonly prime: boolean;
  readonly seconds: number;
  readonly cpu_seconds: null;
  readonly optimized: number;
  readonly failures: number;
  readonly output_bytes: number;
  readonly outputs: readonly Output[];
};

type Environment = NonNullable<ChildProcess.CommandOptions["env"]>;

type Invocation = {
  readonly command: readonly [string, ...string[]];
  readonly cwd: string;
  readonly env: Environment;
};

const save = Effect.fn("save")(function* <A>(file: string, value: A) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(file, (yield* Schema.encodeEffect(Json)(value)) + "\n");
});

const invoke = Effect.fn("invoke")(function* (invocation: Invocation) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [executable, ...args] = invocation.command;

  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(executable, args, {
          cwd: invocation.cwd,
          env: invocation.env,
          extendEnv: true,
          stdin: "inherit",
        }),
      );

      return yield* Effect.all(
        {
          stdout: child.stdout.pipe(Stream.decodeText, Stream.mkString),
          stderr: child.stderr.pipe(Stream.decodeText, Stream.mkString),
          exitCode: child.exitCode,
        },
        { concurrency: "unbounded" },
      );
    }),
  ).pipe(Effect.timeout("180 seconds"));

  yield* check(
    result.exitCode === 0,
    `Command failed (${result.exitCode}): ${Arr.join(invocation.command, " ")}\n${result.stderr}`,
  );

  return result.stdout;
});

const imageWorker = Effect.fn("imageWorker")(function* (repo: string, args: readonly string[]) {
  const path = yield* Path.Path;

  return yield* invoke({
    command: [
      process.execPath,
      "--experimental-strip-types",
      path.join(import.meta.dirname, "images.ts"),
      ...args,
    ],
    cwd: repo,
    env: {},
  });
});

const workload = (name: CaseName, repo: string, root: string, path: Path.Path): Workload => {
  switch (name) {
    case "help":
    case "version":
      return { kind: "info", name };
    case "small":
      return {
        kind: "image",
        name,
        source: path.join(repo, "tests/fixtures/test2.png"),
        widths: [0],
      };
    case "photo":
      return {
        kind: "image",
        name,
        source: path.join(repo, "tests/fixtures/test.jpg"),
        widths: [0],
      };
    case "resize":
      return {
        kind: "image",
        name,
        source: path.join(repo, "tests/fixtures/test.jpg"),
        widths: [1280],
      };
    case "batch":
      return { kind: "image", name, source: path.join(root, "corpus"), widths: [1280] };
    case "sizes":
      return {
        kind: "image",
        name,
        source: path.join(repo, "tests/fixtures/test.jpg"),
        widths: [0, 384, 868, 1200],
      };
    case "small-sizes":
      return {
        kind: "image",
        name,
        source: path.join(repo, "tests/fixtures/test2.png"),
        widths: [0, 128, 256, 384],
      };
  }
};

const jobsFor = Effect.fn("jobsFor")(function* (work: Workload, destination: string) {
  if (work.kind === "info") return [];
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const info = yield* fs.stat(work.source);
  const names = info.type === "Directory" ? yield* fs.readDirectory(work.source) : [];

  const files =
    info.type === "Directory"
      ? Arr.map(Arr.sort(names, Order.String), (file) => path.join(work.source, file))
      : [work.source];

  return Arr.flatMap(files, (source) =>
    Arr.map(work.widths, (width): Job => {
      const suffix = work.widths.length > 1 && width > 0 ? `-${width}` : "";

      return {
        source,
        output: path.join(
          destination,
          `${path.basename(source, path.extname(source))}${suffix}.webp`,
        ),
        width,
      };
    }),
  );
});

const environment = (variant: Variant): Environment => ({
  UV_THREADPOOL_SIZE: undefined,
  NODE_COMPILE_CACHE: undefined,
  NODE_DISABLE_COMPILE_CACHE: undefined,
  ...Rec.map(variant.env, (value) => (value === null ? undefined : value)),
});

type TimedWork = {
  readonly variant: Variant;
  readonly work: Workload;
  readonly invocation: Invocation;
  readonly destination: string;
  readonly jobs: readonly Job[];
  readonly dimensions: HashMap.HashMap<string, { readonly width: number; readonly height: number }>;
};

const runTimed = Effect.fn("runTimed")(function* (timed: TimedWork) {
  const { variant, work, invocation, destination, jobs, dimensions } = timed;

  if (work.kind === "info") {
    const stdout = yield* invoke({
      ...invocation,
      command: [...invocation.command, `--${work.name}`],
    });

    return yield* check(Str.trim(stdout).length > 0, "Empty help/version output");
  }

  if (variant.kind === "img" || variant.kind === "control") {
    const args = [
      "optimize",
      "-s",
      work.source,
      "-o",
      destination,
      "-f",
      "webp",
      "-q",
      "80",
      "-e",
      "4",
      "--yes",
      "--summary-json",
      ...variant.flags,
    ];

    if (work.widths.length > 1)
      args.push("--sizes", Arr.join(Arr.map(Arr.drop(work.widths, 1), String), ","));
    else if (Arr.head(work.widths).pipe(Option.getOrElse(() => 0)) > 0)
      args.push("--width", String(Arr.head(work.widths).pipe(Option.getOrElse(() => 0))));

    const stdout = yield* invoke({ ...invocation, command: [...invocation.command, ...args] });
    const report = yield* Schema.decodeEffect(Report)(stdout);

    return yield* check(
      report.summary.optimized === jobs.length &&
        report.summary.failed === 0 &&
        report.summary.skipped === 0,
      "Unexpected report counts",
    );
  }

  yield* Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* () {
        const args: string[] = [];

        if (variant.kind === "cwebp") {
          args.push("-quiet", "-q", "80", "-m", "4");

          if (jobs.length === 1) args.push("-mt");
          const size = yield* Effect.fromOption(HashMap.get(dimensions, job.source));

          if (job.width > 0 && job.width < size.width)
            args.push(
              "-resize",
              String(job.width),
              String(Math.max(1, Math.floor((job.width * size.height) / size.width + 0.5))),
            );
          args.push(job.source, "-o", job.output);
        } else {
          args.push(job.source, "-auto-orient", "-strip");

          if (job.width > 0) args.push("-resize", `${job.width}x>`);
          args.push(
            "-quality",
            "80",
            "-define",
            "webp:method=4",
            "-define",
            "webp:alpha-quality=100",
            "-define",
            `webp:thread-level=${Number(jobs.length === 1)}`,
            job.output,
          );
        }

        yield* invoke({ ...invocation, command: [...invocation.command, ...args] });
      }),
    { concurrency: variant.workers },
  );
});

const median = (values: readonly number[]) => {
  const sorted = Arr.sort(values, Order.Number);
  const lower = Math.floor((sorted.length - 1) / 2);
  const upper = Math.floor(sorted.length / 2);

  return Arr.reduce(sorted, 0, (sum, value, index) =>
    index === lower || index === upper ? sum + value / (lower === upper ? 1 : 2) : sum,
  );
};

const run = Effect.fn("benchmark")(function* (args: {
  readonly config: string;
  readonly output: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repo = path.resolve(".");

  const sourceConfig = yield* fs.readFileString(args.config);
  const config = yield* Schema.decodeEffect(Schema.fromJsonString(Config))(sourceConfig);

  yield* check(
    Arr.dedupe(Arr.map(config.variants, (variant) => variant.name)).length ===
      config.variants.length,
    "Variant names must be unique",
  );
  yield* check(Arr.dedupe(config.cases).length === config.cases.length, "Cases must be unique");
  const root = path.resolve(args.output);
  yield* fs.makeDirectory(path.dirname(root), { recursive: true });
  yield* fs.makeDirectory(root);
  yield* Effect.gen(function* () {
    const dimensionText = yield* imageWorker(repo, ["prepare", path.join(root, "corpus")]);

    const sourceDimensions = yield* Schema.decodeEffect(Schema.fromJsonString(Dimensions))(
      dimensionText,
    );

    const dimensions = HashMap.fromIterable(Rec.toEntries(sourceDimensions));

    const packageText = yield* fs.readFileString(path.join(repo, "package.json"));

    const pkg = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ img: Schema.String }) })),
    )(packageText);

    const defaultCommand = Arr.make("node", path.join(repo, pkg.bin.img));

    const variants = Arr.map(config.variants, (variant) => ({
      ...variant,
      command: variant.command ?? defaultCommand,
    }));

    let references = HashMap.empty<CaseName, readonly string[]>();
    const rows: Row[] = [];

    const measure = Effect.fn("measure")(function* (
      variant: (typeof variants)[number],
      work: Workload,
      round: number | "prime",
    ) {
      const destination = path.join(root, `${work.name}-${variant.name}-${round}`);
      yield* fs.makeDirectory(destination);
      const env = environment(variant);

      if (variant.cache === "disabled") env.NODE_DISABLE_COMPILE_CACHE = "1";
      else {
        const directory = path.join(
          root,
          variant.cache === "warm"
            ? `warm-cache-${variant.name}`
            : `cold-cache-${work.name}-${variant.name}-${round}`,
        );

        yield* fs.makeDirectory(directory, { recursive: true });
        env.NODE_COMPILE_CACHE = directory;
      }

      const jobs = yield* jobsFor(work, destination);
      const invocation: Invocation = { command: variant.command, cwd: repo, env };
      const start = yield* Clock.monotonicTimeNanos;
      yield* runTimed({ variant, work, invocation, destination, jobs, dimensions });
      const end = yield* Clock.monotonicTimeNanos;
      const manifest = path.join(destination, "manifest.json");
      yield* save(manifest, jobs);

      const outputs =
        jobs.length === 0
          ? []
          : yield* imageWorker(repo, ["validate", manifest]).pipe(
              Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Output)))),
            );

      const hashes = Arr.map(outputs, (output) => output.sha256);

      if (variant.kind === "img") {
        const previous = HashMap.get(references, work.name);

        if (Option.isSome(previous))
          yield* check(
            Arr.makeEquivalence<string>((a, b) => a === b)(previous.value, hashes),
            `Output changed for ${variant.name}/${work.name}`,
          );
        else references = HashMap.set(references, work.name, hashes);
      }

      const row: Row = {
        case: work.name,
        variant: variant.name,
        round,
        prime: round === "prime",
        seconds: Number(end - start) / 1e9,
        cpu_seconds: null,
        optimized: outputs.length,
        failures: 0,
        output_bytes: Arr.reduce(outputs, 0, (sum, output) => sum + output.bytes),
        outputs,
      };

      yield* fs.writeFileString(
        path.join(root, "runs.jsonl"),
        (yield* Schema.encodeEffect(Json)(row)) + "\n",
        { flag: "a" },
      );
      const { outputs: _outputs, ...printed } = row;
      const line = yield* Schema.encodeEffect(Json)(printed);
      yield* Console.log(line);

      return row;
    });

    for (const name of config.cases) {
      const work = workload(name, repo, root, path);

      for (const variant of variants) {
        if (variant.cache === "warm") yield* measure(variant, work, "prime");
      }

      for (let round = 0; round < config.rounds; round++) {
        const offset = round % variants.length;
        const rotated = Arr.appendAll(Arr.drop(variants, offset), Arr.take(variants, offset));

        for (const variant of rotated) {
          const row = yield* measure(variant, work, round);
          rows.push(row);
        }
      }
    }

    const summary = Arr.flatMap(config.cases, (name) =>
      Arr.map(variants, (variant) => {
        const subset = Arr.filter(rows, (row) => row.case === name && row.variant === variant.name);
        const times = Arr.map(subset, (row) => row.seconds);

        return {
          case: name,
          variant: variant.name,
          n: times.length,
          median: median(times),
          minimum: Math.min(...times),
          maximum: Math.max(...times),
          optimized: Arr.reduce(subset, 0, (sum, row) => sum + row.optimized),
          failures: Arr.reduce(subset, 0, (sum, row) => sum + row.failures),
        };
      }),
    );

    yield* save(path.join(root, "summary.json"), summary);
    yield* fs.writeFileString(path.join(root, "config.json"), sourceConfig);
    yield* save(path.join(root, "runs.json"), rows);
  }).pipe(
    Effect.tapCause((cause) =>
      fs.writeFileString(path.join(root, "failure.txt"), Cause.pretty(cause)),
    ),
  );
});

Command.make(
  "benchmark",
  {
    config: Argument.File("config", { mustExist: true }),
    output: Flag.String("output"),
  },
  run,
).pipe(
  Command.withDescription("Measure built image CLIs with decoded output validation."),
  Command.run({ version: "0.1.0" }),
  Effect.tapError((error) => Console.error(String(error))),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
