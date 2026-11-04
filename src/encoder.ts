import { Effect, Match } from "effect";
import sharp from "sharp";
import { type Config, type Job, OptimizationError } from "./options.ts";

export const validateSize = Effect.fn("validateSize")(function* (job: Job, config: Config) {
  if (job.resize.kind === "configured" || config.upscale) return;

  const metadata = yield* Effect.tryPromise({
    try: () => sharp(job.source, { failOn: "warning", limitInputPixels: 268402689 }).metadata(),
    catch: (cause) =>
      OptimizationError.make({ message: `Cannot read ${job.source}: ${String(cause)}` }),
  });

  if (job.resize.width > metadata.autoOrient.width) {
    return yield* OptimizationError.make({
      message: `Requested width ${job.resize.width} exceeds source width ${metadata.autoOrient.width} for ${job.source}. Use --upscale to allow enlargement.`,
    });
  }
});

export const encode = Effect.fn("encode")(function* (job: Job, config: Config) {
  return yield* Effect.tryPromise({
    try: () => {
      let image = sharp(job.source, { failOn: "warning", limitInputPixels: 268402689 }).rotate();

      if (job.resize.kind === "width") {
        image = image.resize({ width: job.resize.width, withoutEnlargement: !config.upscale });
      } else if (config.width > 0 || config.height > 0) {
        image = image.resize({
          width: config.width || undefined,
          height: config.height || undefined,
          fit: config.fit,
          position: config.position,
          background: config.background,
          withoutEnlargement: !config.upscale,
        });
      }

      if (config.flatten) image = image.flatten({ background: config.background });

      if (config.metadata) image = image.keepMetadata();

      return Match.value(config.format)
        .pipe(
          Match.when("webp", () =>
            image.webp({
              quality: config.quality,
              effort: config.effort,
              lossless: config.lossless,
            }),
          ),
          Match.when("avif", () =>
            image.avif({
              quality: config.quality,
              effort: config.effort,
              lossless: config.lossless,
              chromaSubsampling: config.lossless ? "4:4:4" : "4:2:0",
            }),
          ),
          Match.when("jpeg", () => image.jpeg({ quality: config.quality })),
          Match.when("png", () =>
            image.png({ compressionLevel: config.compression, palette: false }),
          ),
          Match.exhaustive,
        )
        .toBuffer();
    },
    catch: (cause) =>
      OptimizationError.make({ message: `Cannot encode ${job.source}: ${String(cause)}` }),
  });
});
