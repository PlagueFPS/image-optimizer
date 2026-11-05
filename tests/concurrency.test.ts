import { expect, test } from "vite-plus/test";
import { defaultConcurrency, defaultThreadPoolSize } from "../src/concurrency.ts";

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

test.each([
  [1, 1],
  [2, 1],
  [4, 3],
  [8, 6],
  [16, 12],
  [21, 15],
  [22, 16],
  [32, 16],
  [128, 16],
])("%i available CPUs default to %i native workers", (cpus, expected) => {
  expect(defaultThreadPoolSize(cpus)).toBe(expected);
});
