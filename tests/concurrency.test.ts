import { expect, test } from "vite-plus/test";
import { defaultConcurrency } from "../src/concurrency.ts";

test.each([
  [1, 1],
  [2, 1],
  [3, 2],
  [4, 3],
  [8, 6],
  [16, 12],
  [32, 24],
  [128, 96],
])("%i available CPUs default to %i file workflows", (cpus, expected) => {
  expect(defaultConcurrency(cpus)).toBe(expected);
});
