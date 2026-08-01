/** Resolves after `durationMs`. Extracted so tests can stub the delay. */
export const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
