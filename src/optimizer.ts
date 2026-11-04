import {
  Array as Arr,
  Effect,
  FileSystem,
  HashSet,
  Path,
  PlatformError,
  Result,
  Schema,
  String as Str,
} from "effect";
import { encode, validateSize } from "./encoder.ts";
import { type Config, type Job, OptimizationError } from "./options.ts";

const extensions = HashSet.make(".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif");

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

  const jobs: Job[] = [];

  const addJob = (file: string) => {
    const relative = path.relative(base, file);

    const stem = Str.slice(0, relative.length - path.extname(relative).length)(relative);

    jobs.push({
      source: file,
      output: path.join(output, `${stem}.${config.format}`),
      resize: { kind: "configured" },
    });

    for (const width of config.sizes) {
      jobs.push({
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

  for (const job of jobs) {
    const destination = yield* canonical(job.output);

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

export const optimize = Effect.fn("optimize")(function* (config: Config) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const jobs = yield* plan(config);

  return yield* Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* () {
        if (!config.dryRun && !config.overwrite && (yield* fs.exists(job.output)))
          return { ...job, status: "skipped" };

        yield* validateSize(job, config);

        if (config.dryRun) return { ...job, status: "planned" };
        const parent = path.dirname(job.output);

        if ((yield* canonical(parent)) !== parent) {
          return yield* OptimizationError.make({
            message: `Output parent contains a symbolic link: ${parent}`,
          });
        }

        yield* fs.makeDirectory(parent, { recursive: true });
        const bytes = yield* encode(job, config);
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

        return { ...job, status: "optimized", bytes: bytes.length };
      }).pipe(
        Effect.result,
        Effect.map(
          Result.match({
            onSuccess: (value) => value,
            onFailure: (error) => ({ ...job, status: "failed", error: String(error) }),
          }),
        ),
      ),
    { concurrency: config.concurrency },
  );
});

export const ReportJson = Schema.fromJsonString(Schema.Unknown);
