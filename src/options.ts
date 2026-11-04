import { Schema } from "effect";

export const Formats = [
  "webp",
  "avif",
  "jpeg",
  "png",
  "gif",
  "tiff",
  "jp2",
  "heif",
  "jxl",
] as const;

export const Positions = [
  "centre",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "entropy",
  "attention",
] as const;

export const Config = Schema.Struct({
  source: Schema.String,
  output: Schema.String,
  format: Schema.Literals(Formats),
  quality: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  effort: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 })),
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  height: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sizes: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  concurrency: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  recursive: Schema.Boolean,
  overwrite: Schema.Boolean,
  dryRun: Schema.Boolean,
  lossless: Schema.Boolean,
  metadata: Schema.Boolean,
  upscale: Schema.Boolean,
  json: Schema.Boolean,
  exclude: Schema.Array(Schema.String),
  fit: Schema.Literals(["inside", "contain", "cover", "fill", "outside"]),
  background: Schema.String,
  position: Schema.Literals(Positions),
  flatten: Schema.Boolean,
  compression: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
});

export type Config = typeof Config.Type;

export type Job = {
  readonly source: string;
  readonly output: string;
  readonly resize:
    | { readonly kind: "configured" }
    | { readonly kind: "width"; readonly width: number };
};

export class OptimizationError extends Schema.TaggedError<
  OptimizationError,
  { readonly brand: unique symbol }
>()("OptimizationError", { message: Schema.String }) {}
