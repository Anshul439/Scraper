
export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 4
): Promise<Array<R | { error: string }>> {
  const results: Array<R | { error: string }> = new Array(items.length);
  let idx = 0;

  async function runner() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        const res = await worker(items[i], i);
        results[i] = res;
      } catch (err) {
        results[i] = { error: (err as Error).message || String(err) };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}
