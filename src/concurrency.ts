export const defaultConcurrency = (availableCpus: number): number =>
  Math.max(1, Math.floor(availableCpus * 0.75));

export const defaultThreadPoolSize = (availableCpus: number): number =>
  Math.min(16, defaultConcurrency(availableCpus));
