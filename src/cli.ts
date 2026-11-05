#!/usr/bin/env node
import { availableParallelism } from "node:os";
import { defaultThreadPoolSize } from "./concurrency.ts";

process.env.UV_THREADPOOL_SIZE ??= String(defaultThreadPoolSize(availableParallelism()));

import("./command.ts").catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`);
  process.exitCode = 1;
});
