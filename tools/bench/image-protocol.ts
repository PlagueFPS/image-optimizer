import { Schema } from "effect";

export const Job = Schema.Struct({
  source: Schema.String,
  output: Schema.String,
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type Job = typeof Job.Type;

export const Output = Schema.Struct({
  bytes: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  psnr: Schema.NullOr(Schema.Finite),
  alphaError: Schema.Finite,
  sha256: Schema.String,
});

export type Output = typeof Output.Type;

export const Dimensions = Schema.Record(
  Schema.String,
  Schema.Struct({ width: Schema.Finite, height: Schema.Finite }),
);
