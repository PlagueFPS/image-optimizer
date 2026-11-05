#!/usr/bin/env -S node --experimental-strip-types
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Order,
  Path,
  PlatformError,
  Record as Rec,
  Schema,
} from "effect";
import { Argument, Command } from "effect/cli";
import { Digest } from "effect/crypto";
import sharp from "sharp";
import { Dimensions, Job, type Output } from "./image-protocol.ts";

const Json = Schema.fromJsonString(Schema.Unknown);

class BenchmarkError extends Schema.TaggedError<
  BenchmarkError,
  { readonly brand: unique symbol }
>()("BenchmarkError", { message: Schema.String }) {}

const check = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(BenchmarkError.make({ message }));

const image = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => BenchmarkError.make({ message: String(cause) }),
  });

const prepare = Effect.fn("prepare")(function* (repo: string, corpus: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(corpus);

  for (let index = 0; index < 12; index++) {
    yield* image(() =>
      sharp(path.join(repo, "tests/fixtures/test.jpg"))
        .extract({ left: index * 12, top: index * 8, width: 3600, height: 2400 })
        .resize(1920)
        .jpeg({ quality: 95 })
        .toFile(path.join(corpus, `photo-${index}.jpg`)),
    );
    yield* image(() =>
      sharp(path.join(repo, "tests/fixtures/test2.png"))
        .modulate({ brightness: 0.8 + index * 0.03 })
        .png()
        .toFile(path.join(corpus, `ui-${index}.png`)),
    );
  }
});

const validate = Effect.fn("validate")(function* (
  job: Job,
): Effect.fn.Return<
  Output,
  BenchmarkError | PlatformError.PlatformError,
  FileSystem.FileSystem | Digest.Digest
> {
  const fs = yield* FileSystem.FileSystem;
  const digest = yield* Digest.Digest;
  const metadata = yield* image(() => sharp(job.output).metadata());
  let reference = sharp(job.source).rotate();

  if (job.width > 0) reference = reference.resize({ width: job.width, withoutEnlargement: true });

  const expected = yield* image(() =>
    reference.ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  );

  const actual = yield* image(() =>
    sharp(job.output).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  );

  yield* check(
    metadata.format === "webp" &&
      expected.info.width === actual.info.width &&
      expected.info.height === actual.info.height &&
      expected.data.length === actual.data.length,
    `Dimension or format mismatch: ${job.output}`,
  );
  let rgb = 0;
  let alpha = 0;

  for (let index = 0; index < expected.data.length; index++) {
    const difference = expected.data[index] - actual.data[index];

    if (index % 4 === 3) alpha += difference * difference;
    else rgb += difference * difference;
  }

  const mse = rgb / (expected.info.width * expected.info.height * 3);
  const psnr = 10 * Math.log10((255 * 255) / mse);
  yield* check(psnr >= 20 && alpha === 0, `Quality or alpha mismatch: ${job.output}`);
  const bytes = yield* fs.readFile(job.output);

  return {
    bytes: bytes.length,
    width: actual.info.width,
    height: actual.info.height,
    psnr: Number.isFinite(psnr) ? psnr : null,
    alphaError: alpha,
    sha256: yield* digest.digestHex(Digest.sha256, bytes),
  };
});

const prepareImages = Effect.fn("prepareImages")(function* (corpus: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repo = path.resolve(".");
  yield* prepare(repo, corpus);
  const names = yield* fs.readDirectory(corpus);

  const sources = Arr.appendAll(
    Arr.map(Arr.sort(names, Order.String), (name) => path.join(corpus, name)),
    [path.join(repo, "tests/fixtures/test.jpg"), path.join(repo, "tests/fixtures/test2.png")],
  );

  let dimensions: typeof Dimensions.Type = {};

  for (const source of sources) {
    const metadata = yield* image(() => sharp(source).metadata());
    dimensions = Rec.set(dimensions, source, metadata.autoOrient);
  }

  return dimensions;
});

const validateImages = Effect.fn("validateImages")(function* (manifest: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(manifest);
  const jobs = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Job)))(text);

  return yield* Effect.forEach(jobs, validate);
});

Command.make("benchmark-images").pipe(
  Command.withSubcommands([
    Command.make("prepare", { corpus: Argument.String("corpus") }, ({ corpus }) =>
      prepareImages(corpus).pipe(
        Effect.flatMap(Schema.encodeEffect(Json)),
        Effect.flatMap(Console.log),
      ),
    ),
    Command.make(
      "validate",
      { manifest: Argument.File("manifest", { mustExist: true }) },
      ({ manifest }) =>
        validateImages(manifest).pipe(
          Effect.flatMap(Schema.encodeEffect(Json)),
          Effect.flatMap(Console.log),
        ),
    ),
  ]),
  Command.run({ version: "0.1.0" }),
  Effect.tapError((error) => Console.error(String(error))),
  Effect.provide([NodeServices.layer, Digest.layerWebCrypto]),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
