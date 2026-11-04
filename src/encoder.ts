import { Effect, String as Str } from "effect";
import sharp, { type Sharp } from "sharp";
import { type Config, type Job, OptimizationError } from "./options.ts";

type Encoder = {
  readonly native: keyof typeof sharp.format;
  readonly frames: "existing" | "all" | "single";
  readonly encode: (image: Sharp, config: Config) => Sharp;
};

const encoders = {
  webp: {
    native: "webp",
    frames: "existing",
    encode: (image, config) =>
      image.webp({ quality: config.quality, effort: config.effort, lossless: config.lossless }),
  },
  avif: {
    native: "heif",
    frames: "existing",
    encode: (image, config) =>
      image.avif({
        quality: config.quality,
        effort: config.effort,
        lossless: config.lossless,
        chromaSubsampling: config.lossless ? "4:4:4" : "4:2:0",
      }),
  },
  jpeg: {
    native: "jpeg",
    frames: "existing",
    encode: (image, config) => image.jpeg({ quality: config.quality }),
  },
  png: {
    native: "png",
    frames: "existing",
    encode: (image, config) => image.png({ compressionLevel: config.compression, palette: false }),
  },
  gif: { native: "gif", frames: "all", encode: (image) => image.gif() },
  tiff: {
    native: "tiff",
    frames: "single",
    encode: (image, config) =>
      image.tiff({ quality: config.quality, compression: config.lossless ? "lzw" : "jpeg" }),
  },
  jp2: {
    native: "jp2",
    frames: "single",
    encode: (image, config) => image.jp2({ quality: config.quality, lossless: config.lossless }),
  },
  heif: {
    native: "heif",
    frames: "single",
    encode: (image, config) =>
      image.heif({
        compression: "hevc",
        quality: config.quality,
        effort: config.effort,
        lossless: config.lossless,
        chromaSubsampling: config.lossless ? "4:4:4" : "4:2:0",
      }),
  },
  jxl: {
    native: "jxl",
    frames: "single",
    encode: (image, config) => image.jxl({ quality: config.quality, lossless: config.lossless }),
  },
} as const satisfies Record<Config["format"], Encoder>;

export const validateEncoder = Effect.fn("validateEncoder")(function* (config: Config) {
  if (config.lossless && (config.format === "jpeg" || config.format === "gif")) {
    return yield* OptimizationError.make({
      message: `${Str.toUpperCase(config.format)} does not support lossless encoding of arbitrary source pixels. Use PNG, WebP, AVIF, TIFF, JP2, HEIF, or JXL.`,
    });
  }

  const encoder = encoders[config.format];

  if (!sharp.format[encoder.native].output.buffer) {
    return yield* OptimizationError.make({
      message: `Output encoder ${config.format} is unavailable in this Sharp build.`,
    });
  }

  yield* Effect.tryPromise({
    try: () =>
      encoder
        .encode(
          sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }),
          config,
        )
        .toBuffer(),
    catch: (cause) =>
      OptimizationError.make({
        message: `Output encoder ${config.format} is unavailable with these settings in this Sharp build: ${String(cause)}`,
      }),
  });
});

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
  const encoder = encoders[config.format];

  if (encoder.frames === "single") {
    const metadata = yield* Effect.tryPromise({
      try: () => sharp(job.source, { failOn: "warning", limitInputPixels: 268402689 }).metadata(),
      catch: (cause) =>
        OptimizationError.make({ message: `Cannot read ${job.source}: ${String(cause)}` }),
    });

    if ((metadata.pages ?? 1) > 1) {
      return yield* OptimizationError.make({
        message: `${config.format} output does not support multi-page input in this CLI. Use GIF output to preserve frames.`,
      });
    }
  }

  return yield* Effect.tryPromise({
    try: () => {
      let image = sharp(job.source, {
        failOn: "warning",
        limitInputPixels: 268402689,
        animated: encoder.frames === "all",
      }).rotate();

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

      return encoders[config.format].encode(image, config).toBuffer();
    },
    catch: (cause) =>
      OptimizationError.make({ message: `Cannot encode ${job.source}: ${String(cause)}` }),
  });
});
