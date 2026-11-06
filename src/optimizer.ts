import {
  Array as Arr,
  Data,
  Effect,
  FileSystem,
  HashMap,
  HashSet,
  Option,
  Path,
  PlatformError,
  Result,
  Record,
  Schema,
  String as Str,
} from "effect";
import { encode, validateInput } from "./encoder.ts";
import { type Config, type Job, OptimizationError } from "./options.ts";

export type SizeMetrics = {
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly savedBytes: number;
  readonly reductionPercent: number;
};

export type RelocationResult = Data.TaggedEnum<{
  Moved: { readonly destination: string };
  Failed: { readonly destination: string; readonly error: string };
}>;

export const RelocationResult = Data.taggedEnum<RelocationResult>();

export type OptimizationResult = Job & { readonly relocation: Option.Option<RelocationResult> } & (
    | ({ readonly status: "optimized"; readonly bytes: number } & SizeMetrics)
    | { readonly status: "skipped" | "planned" }
    | { readonly status: "failed"; readonly error: string }
  );

export type OptimizationSummary = SizeMetrics & {
  readonly optimized: number;
  readonly skipped: number;
  readonly planned: number;
  readonly failed: number;
};

const sizeMetrics = (inputBytes: number, outputBytes: number): SizeMetrics => ({
  inputBytes,
  outputBytes,
  savedBytes: inputBytes - outputBytes,
  reductionPercent: inputBytes === 0 ? 0 : ((inputBytes - outputBytes) / inputBytes) * 100,
});

export const summarize = (results: ReadonlyArray<OptimizationResult>): OptimizationSummary => {
  const totals = Arr.reduce(
    results,
    {
      optimized: 0,
      skipped: 0,
      planned: 0,
      failed: 0,
      inputBytes: 0,
      outputBytes: 0,
    },
    (totals, result) => ({
      ...totals,
      [result.status]: totals[result.status] + 1,
      inputBytes: totals.inputBytes + (result.status === "optimized" ? result.inputBytes : 0),
      outputBytes: totals.outputBytes + (result.status === "optimized" ? result.outputBytes : 0),
    }),
  );

  return { ...totals, ...sizeMetrics(totals.inputBytes, totals.outputBytes) };
};

const extensions = HashSet.make(
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tif",
  ".tiff",
  ".gif",
  ".svg",
);

const canonical = Effect.fn("canonical")(function* (
  location: string,
): Effect.fn.Return<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (yield* fs.exists(location)) return yield* fs.realPath(location);

  const parent = yield* canonical(path.dirname(location));

  return path.join(parent, path.basename(location));
});

export const plan = Effect.fn("plan")(function* (config: Config) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const input = path.resolve(config.source);
  const inputInfo = yield* fs.lstat(input);

  if (inputInfo.type !== "File" && inputInfo.type !== "Directory") {
    return yield* OptimizationError.make({
      message: "Source must be a regular file or directory. Symlinks are not followed.",
    });
  }

  const source = yield* fs.realPath(input);
  const base = inputInfo.type === "File" ? path.dirname(source) : source;
  const output = yield* canonical(path.resolve(config.output));

  const archive = yield* Option.fromUndefinedOr(config.move).pipe(
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (directory) => canonical(path.resolve(directory)).pipe(Effect.asSome),
    }),
  );

  const overlaps = (a: string, b: string) => {
    const relative = path.relative(a, b);

    return (
      relative === "" ||
      (relative !== ".." &&
        !Str.startsWith(".." + path.sep)(relative) &&
        !path.isAbsolute(relative))
    );
  };

  if ((yield* fs.exists(output)) && (yield* fs.stat(output)).type !== "Directory") {
    return yield* OptimizationError.make({ message: "Output must be a directory." });
  }

  if (inputInfo.type === "Directory" && (overlaps(source, output) || overlaps(output, source))) {
    return yield* OptimizationError.make({
      message: "Source and output directories must not overlap.",
    });
  }

  if (Option.isSome(archive)) {
    const directory = archive.value;

    if ((yield* fs.exists(directory)) && (yield* fs.stat(directory)).type !== "Directory") {
      return yield* OptimizationError.make({ message: "--move must be a directory." });
    }

    if (
      overlaps(directory, source) ||
      overlaps(source, directory) ||
      overlaps(directory, output) ||
      overlaps(output, directory)
    ) {
      return yield* OptimizationError.make({
        message: "Source, output, and archive paths must not overlap.",
      });
    }
  }

  const jobs: Job[] = [];

  const addJob = (file: string) => {
    const relative = path.relative(base, file);

    const stem = Str.slice(0, relative.length - path.extname(relative).length)(relative);

    jobs.push({
      archive: Option.map(archive, (directory) => path.join(directory, relative)),
      source: file,
      output: path.join(output, `${stem}.${config.format}`),
      resize: { kind: "configured" },
    });

    for (const width of config.sizes) {
      jobs.push({
        archive: Option.map(archive, (directory) => path.join(directory, relative)),
        source: file,
        output: path.join(output, `${stem}-${width}.${config.format}`),
        resize: { kind: "width", width },
      });
    }
  };

  const walk = Effect.fn("walk")(function* (
    directory: string,
  ): Effect.fn.Return<void, PlatformError.PlatformError, FileSystem.FileSystem> {
    const names = yield* fs.readDirectory(directory);

    for (const name of Arr.sort(names, Str.Order)) {
      const file = path.join(directory, name);
      const relativePath = Arr.join(Str.split(path.sep)(path.relative(base, file)), "/");

      if (
        Arr.some(
          config.exclude,
          (prefix) => relativePath === prefix || Str.startsWith(prefix + "/")(relativePath),
        )
      )
        continue;
      const info = yield* fs.lstat(file);

      if (info.type === "Directory" && config.recursive) yield* walk(file);

      if (info.type === "File" && HashSet.has(extensions, Str.toLowerCase(path.extname(name)))) {
        addJob(file);
      }
    }
  });

  if (inputInfo.type === "File") {
    if (!HashSet.has(extensions, Str.toLowerCase(path.extname(source)))) {
      return yield* OptimizationError.make({
        message: `Unsupported input extension: ${path.extname(source)}`,
      });
    }

    addJob(source);
  } else yield* walk(source);

  let archives = HashSet.empty<string>();

  for (const job of jobs) {
    if (Option.isNone(job.archive) || job.resize.kind !== "configured") continue;
    const archive = job.archive.value;
    const destination = Str.toLowerCase(archive);

    if (HashSet.has(archives, destination)) {
      return yield* OptimizationError.make({ message: "Multiple inputs map to the same archive." });
    }

    archives = HashSet.add(archives, destination);
    const parent = path.dirname(archive);

    if ((yield* canonical(parent)) !== parent) {
      return yield* OptimizationError.make({
        message: `Archive parent contains a symbolic link: ${parent}`,
      });
    }

    const info = yield* fs.lstat(archive).pipe(
      Effect.asSome,
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
    );

    if (Option.isSome(info)) {
      return yield* OptimizationError.make({ message: `Archive already exists: ${archive}` });
    }
  }

  for (const job of jobs) {
    const destination = yield* canonical(job.output);

    if (
      Option.isSome(archive) &&
      (yield* canonical(path.dirname(job.output))) !== path.dirname(job.output)
    ) {
      return yield* OptimizationError.make({
        message: `Output parent contains a symbolic link: ${path.dirname(job.output)}`,
      });
    }

    if (Str.toLowerCase(destination) === Str.toLowerCase(job.source)) {
      return yield* OptimizationError.make({
        message:
          "Output would replace an original image. Choose another output directory or format.",
      });
    }
  }

  const destinations = HashSet.fromIterable(Arr.map(jobs, (job) => Str.toLowerCase(job.output)));

  if (HashSet.size(destinations) !== jobs.length) {
    return yield* OptimizationError.make({
      message: "Multiple inputs map to the same output. Rename conflicting source files.",
    });
  }

  return jobs;
});

export const optimize = Effect.fn("optimize")(function* (config: Config, jobs: ReadonlyArray<Job>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const results = yield* Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* (): Effect.gen.Return<
        OptimizationResult,
        PlatformError.PlatformError | OptimizationError,
        FileSystem.FileSystem | Path.Path
      > {
        if (!config.dryRun && !config.overwrite && (yield* fs.exists(job.output)))
          return { ...job, relocation: Option.none(), status: "skipped" };

        const input = yield* validateInput(job, config);

        if (config.dryRun) return { ...job, relocation: Option.none(), status: "planned" };
        const parent = path.dirname(job.output);

        if ((yield* canonical(parent)) !== parent) {
          return yield* OptimizationError.make({
            message: `Output parent contains a symbolic link: ${parent}`,
          });
        }

        yield* fs.makeDirectory(parent, { recursive: true });
        const inputBytes = Number((yield* fs.stat(job.source)).size);
        const bytes = yield* encode(job, config, input);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const temporary = yield* fs.makeTempDirectoryScoped({
              directory: parent,
              prefix: ".img-",
            });

            const staging = path.join(temporary, "image");
            yield* fs.writeFile(staging, bytes);

            if (config.overwrite) yield* fs.rename(staging, job.output);
            else yield* fs.link(staging, job.output);
          }),
        );

        return {
          ...job,
          relocation: Option.none(),
          status: "optimized",
          bytes: bytes.length,
          ...sizeMetrics(inputBytes, bytes.length),
        };
      }).pipe(
        Effect.result,
        Effect.map(
          Result.match({
            onSuccess: (value) => value,
            onFailure: (error): OptimizationResult => ({
              ...job,
              relocation: Option.none(),
              status: "failed",
              error: String(error),
            }),
          }),
        ),
      ),
    { concurrency: config.concurrency },
  );

  const sources = Arr.groupBy(results, (result) => result.source);
  let relocations = HashMap.empty<string, RelocationResult>();

  for (const [source, outputs] of Record.toEntries(sources)) {
    const destination = Arr.headNonEmpty(outputs).archive;

    if (
      Option.isNone(destination) ||
      !Arr.every(outputs, (result) => result.status === "optimized")
    )
      continue;

    const archive = destination.value;

    const moved = yield* Effect.scoped(
      Effect.gen(function* () {
        const parent = path.dirname(archive);

        if ((yield* canonical(parent)) !== parent) {
          return yield* OptimizationError.make({
            message: `Archive parent contains a symbolic link: ${parent}`,
          });
        }

        yield* fs.makeDirectory(parent, { recursive: true });

        const temporary = yield* fs.makeTempDirectoryScoped({
          directory: parent,
          prefix: ".img-move-",
        });

        const staging = path.join(temporary, "original");
        yield* fs.copyFile(source, staging);
        yield* fs.link(staging, archive);
        yield* fs.remove(source);
      }),
    ).pipe(Effect.result);

    relocations = HashMap.set(
      relocations,
      source,
      Result.match(moved, {
        onSuccess: () => RelocationResult.Moved({ destination: archive }),
        onFailure: (error) =>
          RelocationResult.Failed({
            destination: archive,
            error: String(error),
          }),
      }),
    );
  }

  return Arr.map(results, (result): OptimizationResult => ({
    ...result,
    relocation: HashMap.get(relocations, result.source),
  }));
});

export const ReportJson = Schema.fromJsonString(Schema.Unknown);
