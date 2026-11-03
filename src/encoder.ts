import { Effect, Match } from "effect";
import sharp from "sharp";
import { type Config, OptimizationError } from "./options.ts";

export const encode = Effect.fn("encode")(function* (source: string, config: Config) {
  return yield* Effect.tryPromise({
    try: () => {
      let image = sharp(source, { failOn: "warning", limitInputPixels: 268402689 }).rotate();

      if (config.width > 0 || config.height > 0) {
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
      OptimizationError.make({ message: `Cannot encode ${source}: ${String(cause)}` }),
  });
});
