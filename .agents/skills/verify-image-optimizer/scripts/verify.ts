#!/usr/bin/env -S node --experimental-strip-types
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Cause,
  Console,
  Effect,
  Equivalence,
  FileSystem,
  Layer,
  Match,
  Option,
  Order,
  Path,
  Schema,
  Stream,
  String as Str,
} from "effect";
import { Command, Flag } from "effect/cli";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import sharp from "sharp";

const Features = ["conversion", "resize", "directories", "dry-run", "safety"] as const;
type Feature = (typeof Features)[number];
const Report = Schema.fromJsonString(
  Schema.Array(
    Schema.Union([
      Schema.Struct({
        source: Schema.String,
        output: Schema.String,
        status: Schema.Literals(["planned", "skipped"]),
      }),
      Schema.Struct({
        source: Schema.String,
        output: Schema.String,
        status: Schema.Literal("optimized"),
        bytes: Schema.Finite,
      }),
      Schema.Struct({
        source: Schema.String,
        output: Schema.String,
        status: Schema.Literal("failed"),
        error: Schema.String,
      }),
    ]),
  ),
);
class VerificationError extends Schema.TaggedError<
  VerificationError,
  { readonly brand: unique symbol }
>()("VerificationError", { message: Schema.String }) {}
const check = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(VerificationError.make({ message }));
const Json = Schema.fromJsonString(Schema.Unknown);
const sameInventory = Arr.makeEquivalence(
  Equivalence.Struct({ file: Equivalence.String, sha256: Equivalence.String }),
);
const save = Effect.fn("save")(function* (file: string, value: unknown) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(file, (yield* Schema.encodeEffect(Json)(value)) + "\n");
});
const digest = Effect.fn("digest")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const hashing = yield* Digest.Digest;
  return yield* hashing.digestHex(Digest.sha256, yield* fs.readFile(file));
});
const inventory = Effect.fn("inventory")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = Arr.sort(yield* fs.readDirectory(root, { recursive: true }), Order.String);
  return yield* Effect.forEach(
    names,
    Effect.fn(function* (name) {
      const file = path.join(root, name);
      if ((yield* fs.stat(file)).type !== "File") return Option.none();
      return Option.some({ file: name, sha256: yield* digest(file) });
    }),
  ).pipe(Effect.map(Arr.getSomes));
});
const run = Effect.fn("run")(function* (args: ReadonlyArray<string>, cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(ChildProcess.make("node", args, { cwd, stdin: "ignore" }));
      return yield* Effect.all(
        {
          stdout: child.stdout.pipe(Stream.decodeText, Stream.mkString),
          stderr: child.stderr.pipe(Stream.decodeText, Stream.mkString),
          exit_code: child.exitCode,
        },
        { concurrency: "unbounded" },
      );
    }),
  ).pipe(Effect.timeout("60 seconds"));
});
const layout = Effect.gen(function* () {
  const path = yield* Path.Path;
  const repo = path.resolve(import.meta.dirname, "../../../..");
  return { repo, cli: path.join(repo, "dist/cli.mjs") };
});
const doctor = Effect.fn("doctor")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { repo, cli } = yield* layout;
  yield* check(yield* fs.exists(cli), "Run vp pack first");
  const modified = (info: FileSystem.File.Info) =>
    Option.getOrElse(
      Option.map(info.mtime, (date) => date.getTime()),
      () => 0,
    );
  const built = modified(yield* fs.stat(cli));
  for (const file of yield* fs.readDirectory(path.join(repo, "src"))) {
    if (Str.endsWith(".ts")(file))
      yield* check(
        built >= modified(yield* fs.stat(path.join(repo, "src", file))),
        "Stale build: run vp pack",
      );
  }
  const runtime = yield* run(["--version"], repo);
  const version = yield* Schema.decodeEffect(
    Schema.Struct({ major: Schema.FiniteFromString, minor: Schema.FiniteFromString }),
  )({
    major: Str.split(".")(Str.replace(/^v/, "")(Str.trim(runtime.stdout)))[0],
    minor: Str.split(".")(Str.trim(runtime.stdout))[1],
  });
  yield* check(
    version.major > 22 || (version.major === 22 && version.minor >= 12),
    "Node >=22.12 required",
  );
  const help = yield* run([cli, "optimize", "--help"], repo);
  yield* check(
    help.exit_code === 0 &&
      Str.includes("--source")(help.stdout) &&
      Str.includes("--dry-run")(help.stdout),
    "Optimize help unavailable",
  );
  const pkg = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
  )(yield* fs.readFileString(path.join(repo, "package.json")));
  const cliVersion = yield* run([cli, "--version"], repo);
  yield* check(
    cliVersion.exit_code === 0 && Str.includes(pkg.version)(cliVersion.stdout),
    "CLI version mismatch",
  );
  for (const fixture of ["test.jpg", "test2.png"]) {
    yield* Effect.tryPromise(() => sharp(path.join(repo, "tests/fixtures", fixture)).metadata());
  }
  return {
    repo,
    node: Str.trim(runtime.stdout),
    version: Str.trim(cliVersion.stdout),
    cli_sha256: yield* digest(cli),
  };
});

const drive = Effect.fn("drive")(function* (feature: Feature, directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { repo, cli } = yield* layout;
  const evidence = path.resolve(directory);
  yield* fs.makeDirectory(path.dirname(evidence), { recursive: true });
  yield* fs.makeDirectory(evidence);
  const write = (name: string, value: unknown) => save(path.join(evidence, name), value);
  const commands: Array<{
    readonly command: ReadonlyArray<string>;
    readonly cwd: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly exit_code: number;
  }> = [];
  yield* Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* Effect.acquireRelease(
        fs.makeTempDirectory({ prefix: "image-optimizer-verify-" }),
        (scratch) =>
          Effect.gen(function* () {
            yield* fs.remove(scratch, { recursive: true });
            yield* write("cleanup.json", { scratch, removed: !(yield* fs.exists(scratch)) });
          }).pipe(Effect.orDie),
      );
      yield* fs.writeFileString(path.join(evidence, "scratch.txt"), scratch);
      const execute = Effect.fn("execute")(function* (input: {
        readonly source: string;
        readonly output: string;
        readonly flags?: ReadonlyArray<string>;
        readonly status?: number;
        readonly human?: boolean;
      }) {
        const args = [
          cli,
          "optimize",
          "-s",
          input.source,
          "-o",
          input.output,
          ...((input.human ?? false) ? [] : ["--json"]),
          ...(input.flags ?? []),
        ];
        const result = yield* run(args, scratch);
        commands.push({ command: ["node", ...args], cwd: scratch, ...result });
        yield* write("commands.json", commands);
        yield* check(
          result.exit_code === (input.status ?? 0),
          `Unexpected exit code ${result.exit_code}; see commands.json`,
        );
        return result.stdout;
      });
      const invoke = Effect.fn("invoke")(function* (
        source: string,
        output: string,
        ...flags: ReadonlyArray<string>
      ) {
        return yield* Schema.decodeEffect(Report)(yield* execute({ source, output, flags }));
      });
      const reject = (source: string, output: string, ...flags: ReadonlyArray<string>) =>
        execute({ source, output, flags, status: 1 });
      const metadata = Effect.fn("metadata")(function* (file: string) {
        const image = sharp(file);
        const data = yield* Effect.tryPromise(() => image.metadata());
        yield* Effect.tryPromise(() => image.raw().toBuffer());
        yield* write(
          `${path.basename(path.dirname(file))}-${path.basename(file)}.metadata.json`,
          data,
        );
        return data;
      });
      yield* write("doctor.json", yield* doctor());
      const source = path.join(scratch, "input");
      const photo = path.join(source, "photo.jpg");
      const second = path.join(source, "nested/second.png");
      const output = path.join(scratch, "output");
      yield* fs.makeDirectory(path.dirname(second), { recursive: true });
      yield* fs.copyFile(path.join(repo, "tests/fixtures/test.jpg"), photo);
      yield* fs.copyFile(path.join(repo, "tests/fixtures/test2.png"), second);
      if (feature === "directories") yield* fs.symlink(photo, path.join(source, "linked.jpg"));
      const before = yield* inventory(source);
      yield* write("inputs-before.json", before);
      yield* Match.value(feature).pipe(
        Match.when("conversion", () =>
          Effect.gen(function* () {
            for (const format of ["webp", "avif", "jpeg", "png"]) {
              const dest = path.join(scratch, format);
              const report = yield* invoke(photo, dest, "--format", format, "--width", "32");
              const encoded = path.join(dest, `photo.${format}`);
              const item = yield* Effect.fromOption(Arr.head(report));
              yield* check(
                report.length === 1 &&
                  item.status === "optimized" &&
                  item.bytes === Number((yield* fs.stat(encoded)).size),
                "Conversion report or byte count mismatch",
              );
              const meta = yield* metadata(encoded);
              yield* check(
                meta.width === 32 && meta.format === (format === "avif" ? "heif" : format),
                "Conversion dimensions or format mismatch",
              );
            }
            yield* check(
              Str.includes("optimized:")(yield* execute({ source: photo, output, human: true })),
              "Human-readable report missing",
            );
            yield* check(
              (yield* metadata(path.join(output, "photo.webp"))).format === "webp",
              "Default format is not WebP",
            );
          }),
        ),
        Match.when("resize", () =>
          Effect.gen(function* () {
            for (const fit of ["inside", "outside", "cover", "contain", "fill"]) {
              const dest = path.join(scratch, fit);
              yield* invoke(second, dest, "--width", "20", "--height", "20", "--fit", fit);
              const meta = yield* metadata(path.join(dest, "second.webp"));
              const valid = Match.value(fit).pipe(
                Match.when("inside", () => meta.width === 20 && meta.height < 20),
                Match.when("outside", () => meta.width > 20 && meta.height === 20),
                Match.orElse(() => meta.width === 20 && meta.height === 20),
              );
              yield* check(valid, `Unexpected dimensions for ${fit}`);
            }
            for (const upscale of [false, true]) {
              const dest = path.join(scratch, upscale ? "upscale" : "small");
              yield* invoke(second, dest, "--width", "1000", ...(upscale ? ["--upscale"] : []));
              yield* check(
                (yield* metadata(path.join(dest, "second.webp"))).width === (upscale ? 1000 : 567),
                "Upscaling dimensions mismatch",
              );
            }
          }),
        ),
        Match.when("directories", () =>
          Effect.gen(function* () {
            yield* check(
              (yield* invoke(source, output, "--width", "16")).length === 1,
              "Shallow report must have one image",
            );
            yield* check(
              !(yield* fs.exists(path.join(output, "nested"))),
              "Shallow run created nested output",
            );
            const recursive = path.join(scratch, "recursive");
            const report = yield* invoke(
              source,
              recursive,
              "--recursive",
              "--width",
              "16",
              "--concurrency",
              "2",
            );
            yield* check(
              report.length === 2 && Arr.every(report, (item) => item.status === "optimized"),
              "Recursive report mismatch",
            );
            for (const file of ["photo.webp", "nested/second.webp"])
              yield* check(
                (yield* metadata(path.join(recursive, file))).width === 16,
                "Recursive output dimensions mismatch",
              );
            const excluded = path.join(scratch, "excluded");
            yield* check(
              (yield* invoke(source, excluded, "--recursive", "--exclude", "nested")).length === 1,
              "Exclusion report mismatch",
            );
            yield* check(
              !(yield* fs.exists(path.join(excluded, "nested"))) &&
                !(yield* fs.exists(path.join(recursive, "linked.webp"))),
              "Excluded or linked output created",
            );
          }),
        ),
        Match.when("dry-run", () =>
          Effect.gen(function* () {
            for (const scenario of [
              { flags: [], count: 1 },
              { flags: ["--recursive"], count: 2 },
              { flags: ["--recursive", "--exclude", "nested"], count: 1 },
            ]) {
              const previous = yield* inventory(scratch);
              const report = yield* invoke(source, output, "--dry-run", ...scenario.flags);
              yield* check(
                report.length === scenario.count &&
                  Arr.every(report, (item) => item.status === "planned"),
                "Dry-run report mismatch",
              );
              for (const item of report)
                yield* check(!(yield* fs.exists(item.output)), "Dry-run wrote a destination");
              yield* check(
                !(yield* fs.exists(output)) && sameInventory(yield* inventory(scratch), previous),
                "Dry-run changed filesystem",
              );
            }
            yield* write("dry-run-tree.json", yield* inventory(scratch));
          }),
        ),
        Match.when("safety", () =>
          Effect.gen(function* () {
            yield* invoke(photo, output, "--width", "16");
            const encoded = path.join(output, "photo.webp");
            const original = yield* digest(encoded);
            const skipped = yield* invoke(photo, output, "--width", "32");
            yield* check(
              (yield* Effect.fromOption(Arr.head(skipped))).status === "skipped" &&
                (yield* digest(encoded)) === original,
              "Skip changed output",
            );
            const replaced = yield* invoke(photo, output, "--width", "32", "--overwrite");
            yield* check(
              (yield* Effect.fromOption(Arr.head(replaced))).status === "optimized" &&
                (yield* digest(encoded)) !== original &&
                (yield* metadata(encoded)).width === 32,
              "Overwrite did not replace output",
            );
            yield* reject(source, path.join(source, "overlap"));
            yield* check(
              !(yield* fs.exists(path.join(source, "overlap"))),
              "Overlap created output",
            );
            yield* reject(second, path.dirname(second), "--format", "png", "--overwrite");
            const invalid = path.join(scratch, "invalid");
            yield* reject(photo, invalid, "--quality", "101");
            yield* check(!(yield* fs.exists(invalid)), "Invalid quality created output");
            const collisions = path.join(scratch, "collisions");
            yield* fs.makeDirectory(collisions);
            yield* fs.copyFile(photo, path.join(collisions, "same.jpg"));
            yield* fs.copyFile(second, path.join(collisions, "same.png"));
            yield* reject(collisions, path.join(scratch, "collision-output"));
            yield* check(
              !(yield* fs.exists(path.join(scratch, "collision-output"))),
              "Collision created output",
            );
            const broken = path.join(scratch, "broken");
            yield* fs.makeDirectory(broken);
            yield* fs.copyFile(photo, path.join(broken, "valid.jpg"));
            yield* fs.writeFileString(path.join(broken, "broken.png"), "invalid image");
            const partial = path.join(scratch, "partial");
            const report = yield* Schema.decodeEffect(Report)(yield* reject(broken, partial));
            yield* check(
              report.length === 2 &&
                Arr.some(report, (item) => item.status === "failed") &&
                Arr.some(report, (item) => item.status === "optimized"),
              "Partial failure report mismatch",
            );
            yield* check(
              (yield* metadata(path.join(partial, "valid.webp"))).format === "webp" &&
                !(yield* fs.exists(path.join(partial, "broken.webp"))),
              "Partial failure output mismatch",
            );
          }),
        ),
        Match.exhaustive,
      );
      const after = yield* inventory(source);
      yield* write("inputs-after.json", after);
      yield* check(sameInventory(before, after), "Original images changed");
      yield* write("files.json", yield* inventory(scratch));
      for (const item of yield* inventory(scratch)) {
        const file = path.join(scratch, item.file);
        if ((yield* fs.lstat(file)).type !== "File") continue;
        const target = path.join(evidence, "files", item.file);
        yield* fs.makeDirectory(path.dirname(target), { recursive: true });
        yield* fs.copyFile(file, target);
      }
      yield* write("result.json", { feature, status: "passed" });
    }),
  ).pipe(
    Effect.tapCause((cause) =>
      fs.writeFileString(path.join(evidence, "failure.txt"), Cause.pretty(cause)),
    ),
  );
  yield* check(
    (yield* fs.exists(path.join(evidence, "commands.json"))) &&
      (yield* fs.exists(path.join(evidence, "result.json"))),
    "Evidence missing after cleanup",
  );
  yield* Console.log(evidence);
});

const command = Command.make("verify-image-optimizer").pipe(
  Command.withDescription(
    "Drive the built CLI with disposable inputs and retain verification evidence.",
  ),
  Command.withSubcommands([
    Command.make("doctor", {}, () =>
      doctor().pipe(Effect.flatMap(Schema.encodeEffect(Json)), Effect.flatMap(Console.log)),
    ),
    ...Arr.map(Features, (feature) =>
      Command.make(
        feature,
        {
          evidence: Flag.String("evidence").pipe(
            Flag.withDescription("New evidence directory outside scratch"),
          ),
        },
        ({ evidence }) => drive(feature, evidence),
      ),
    ),
  ]),
);
Command.run(command, { version: "0.1.0" }).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, Digest.layerWebCrypto)),
  NodeRuntime.runMain,
);
