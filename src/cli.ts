#!/usr/bin/env node
import { availableParallelism } from "node:os";
import { defaultThreadPoolSize } from "./concurrency.ts";

process.env.UV_THREADPOOL_SIZE ??= String(defaultThreadPoolSize(availableParallelism()));

await import("./command.ts");
