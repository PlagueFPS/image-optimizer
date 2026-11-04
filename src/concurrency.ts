export const defaultConcurrency = (availableCpus: number): number =>
  Math.max(1, Math.floor(availableCpus * 0.75));
