import { Array as Arr, Effect, Match } from "effect";
import sharp, { type Sharp, type SharpOptions } from "sharp";
import { type Config, type Job, OptimizationError } from "./options.ts";

type ImageInput =
  | { readonly animated: false }
  | { readonly animated: true; readonly delay: number[]; readonly loop: number };

const supportsAnimation: Record<Config["format"], boolean> = {
  webp: true,
  avif: false,
  jpeg: false,
  png: false,
};

export const validateInput = Effect.fn("validateInput")(function* (job: Job, config: Config) {
  const metadata = yield* Effect.tryPromise({
    try: () => sharp(job.source, { failOn: "warning", limitInputPixels: 268402689 }).metadata(),
    catch: (cause) =>
      OptimizationError.make({ message: `Cannot read ${job.source}: ${String(cause)}` }),
  });

  const animated = (metadata.pages ?? 1) > 1 && metadata.delay !== undefined;

  if (animated && !supportsAnimation[config.format]) {
    return yield* OptimizationError.make({
      message: `Cannot convert animated input ${job.source} to ${config.format}. Use --format webp to preserve animation.`,
    });
  }

  if (animated && metadata.orientation !== undefined && metadata.orientation !== 1) {
    return yield* OptimizationError.make({
      message: `Cannot auto-orient animated input ${job.source}. Normalize frame orientation before conversion.`,
    });
  }

  if (
    job.resize.kind === "width" &&
    !config.upscale &&
    job.resize.width > metadata.autoOrient.width
  ) {
    return yield* OptimizationError.make({
      message: `Requested width ${job.resize.width} exceeds source width ${metadata.autoOrient.width} for ${job.source}. Use --upscale to allow enlargement.`,
    });
  }

  if (animated && metadata.delay !== undefined) {
    if (Arr.some(metadata.delay, (delay) => delay <= 10 || delay > 65535)) {
      return yield* OptimizationError.make({
        message: `Cannot preserve animation delays for ${job.source}. WebP encoding requires frame delays between 11 and 65535 milliseconds.`,
      });
    }

    return { animated: true, delay: metadata.delay, loop: metadata.loop ?? 0 } satisfies ImageInput;
  }

  return { animated: false } satisfies ImageInput;
});

export const encode = Effect.fn("encode")(function* (job: Job, config: Config, input: ImageInput) {
  return yield* Effect.tryPromise({
    try: async () => {
      const transform = (source: Sharp) => {
        let image = source.rotate();

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

        return image;
      };

      const readOptions = { failOn: "warning", limitInputPixels: 268402689 } satisfies SharpOptions;
      let image: Sharp;
      const resizing = job.resize.kind === "width" || config.width > 0 || config.height > 0;

      if (input.animated && resizing) {
        const frames: Buffer[] = [];

        for (let page = 0; page < input.delay.length; page++) {
          frames.push(
            await transform(sharp(job.source, { ...readOptions, page, pages: 1 }))
              .png()
              .toBuffer(),
          );
        }

        image = sharp(frames, { ...readOptions, join: { animated: true } });

        if (config.metadata) image = image.keepMetadata();
      } else {
        image = transform(sharp(job.source, { ...readOptions, animated: input.animated }));
      }

      return Match.value(config.format)
        .pipe(
          Match.when("webp", () =>
            image.webp({
              quality: config.quality,
              effort: config.effort,
              lossless: config.lossless,
              delay: input.animated ? input.delay : undefined,
              loop: input.animated ? input.loop : undefined,
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
