// utils/concurrency.ts
export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 4
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const active: Promise<void>[] = [];

  async function runner() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        const res = await worker(items[i], i);
        results[i] = res;
      } catch (err) {
        // Put the error as the result so calling code can interpret it,
        // or rethrow depending on how you want to handle it.
        throw err;
      }
    }
  }

  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    active.push(runner());
  }
  await Promise.all(active);
  return results;
}
