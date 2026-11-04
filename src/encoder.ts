import { Array as Arr, Effect, String as Str } from "effect";
import sharp, { type Sharp, type SharpOptions } from "sharp";
import { type Config, type Job, OptimizationError } from "./options.ts";

type ImageInput =
  | { readonly animated: false }
  | { readonly animated: true; readonly delay: number[]; readonly loop: number };

type Encoder = {
  readonly native: keyof typeof sharp.format;
  readonly animation: false | { readonly min: number; readonly max: number; readonly step: number };
  readonly encode: (image: Sharp, config: Config, input: ImageInput) => Sharp;
};

const encoders = {
  webp: {
    native: "webp",
    animation: { min: 11, max: 65535, step: 1 },
    encode: (image, config, input) =>
      image.webp({
        quality: config.quality,
        effort: config.effort,
        lossless: config.lossless,
        delay: input.animated ? input.delay : undefined,
        loop: input.animated ? input.loop : undefined,
      }),
  },
  avif: {
    native: "heif",
    animation: false,
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
    animation: false,
    encode: (image, config) => image.jpeg({ quality: config.quality }),
  },
  png: {
    native: "png",
    animation: false,
    encode: (image, config) => image.png({ compressionLevel: config.compression, palette: false }),
  },
  gif: {
    native: "gif",
    animation: { min: 10, max: 65530, step: 10 },
    encode: (image, _config, input) =>
      image.gif({
        delay: input.animated ? input.delay : undefined,
        loop: input.animated ? input.loop : undefined,
      }),
  },
  tiff: {
    native: "tiff",
    animation: false,
    encode: (image, config) =>
      image.tiff({ quality: config.quality, compression: config.lossless ? "lzw" : "jpeg" }),
  },
} as const satisfies Record<Config["format"], Encoder>;

export const validateEncoder = Effect.fn("validateEncoder")(function* (config: Config) {
  if (config.lossless && (config.format === "jpeg" || config.format === "gif")) {
    return yield* OptimizationError.make({
      message: `${Str.toUpperCase(config.format)} does not support lossless encoding of arbitrary source pixels. Use PNG, WebP, AVIF, or TIFF.`,
    });
  }

  const encoder = encoders[config.format];

  if (!sharp.format[encoder.native].output.buffer) {
    return yield* OptimizationError.make({
      message: `Output encoder ${config.format} is unavailable in this Sharp build.`,
    });
  }
});

export const validateInput = Effect.fn("validateInput")(function* (job: Job, config: Config) {
  const metadata = yield* Effect.tryPromise({
    try: () => sharp(job.source, { failOn: "warning", limitInputPixels: 268402689 }).metadata(),
    catch: (cause) =>
      OptimizationError.make({ message: `Cannot read ${job.source}: ${String(cause)}` }),
  });

  const animated = (metadata.pages ?? 1) > 1 && metadata.delay !== undefined;

  if (animated && encoders[config.format].animation === false) {
    return yield* OptimizationError.make({
      message: `Cannot convert animated input ${job.source} to ${config.format}. Use --format webp or gif with representable timing to preserve animation.`,
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
    const timing = encoders[config.format].animation;

    if (
      timing !== false &&
      Arr.some(
        metadata.delay,
        (delay) => delay < timing.min || delay > timing.max || delay % timing.step !== 0,
      )
    ) {
      return yield* OptimizationError.make({
        message: `Cannot preserve animation delays for ${job.source}. ${Str.toUpperCase(config.format)} encoding requires frame delays between ${timing.min} and ${timing.max} milliseconds in steps of ${timing.step}.`,
      });
    }

    const loop = metadata.loop ?? 0;

    if (loop < 0 || loop > 65535 || !Number.isInteger(loop)) {
      return yield* OptimizationError.make({
        message: `Cannot preserve animation loop count ${loop} for ${job.source}. Encoding requires a loop count between 0 and 65535.`,
      });
    }

    return { animated: true, delay: metadata.delay, loop } satisfies ImageInput;
  }

  return { animated: false } satisfies ImageInput;
});

export const encode = Effect.fn("encode")(function* (job: Job, config: Config, input: ImageInput) {
  return yield* Effect.gen(function* () {
    const transform = (source: Sharp) => {
      let image = source.rotate();

      if (job.resize.kind === "width") {
        image = image.resize({
          width: job.resize.width,
          withoutEnlargement: !config.upscale,
        });
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

    const readOptions = {
      failOn: "warning",
      limitInputPixels: 268402689,
    } satisfies SharpOptions;

    let image: Sharp;
    const resizing = job.resize.kind === "width" || config.width > 0 || config.height > 0;

    if (input.animated && resizing) {
      const frames: Buffer[] = [];

      for (let page = 0; page < input.delay.length; page++) {
        const frame = yield* Effect.promise(() =>
          transform(sharp(job.source, { ...readOptions, page, pages: 1 }))
            .png()
            .toBuffer(),
        );

        frames.push(frame);
      }

      image = sharp(frames, { ...readOptions, join: { animated: true } });

      if (config.metadata) image = image.keepMetadata();
    } else {
      image = transform(sharp(job.source, { ...readOptions, animated: input.animated }));
    }

    return yield* Effect.promise(() =>
      encoders[config.format].encode(image, config, input).toBuffer(),
    );
  }).pipe(
    Effect.catchDefect((cause) =>
      OptimizationError.make({ message: `Cannot encode ${job.source}: ${String(cause)}` }),
    ),
  );
});
