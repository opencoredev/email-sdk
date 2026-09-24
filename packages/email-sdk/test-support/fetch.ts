type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

/**
 * Turns a plain request handler into a `typeof fetch` without a type assertion.
 * Bun's `fetch` type also carries `preconnect`, which adapters never call, so the
 * stub borrows the real one to satisfy the type honestly.
 */
export function stubFetch(handler: FetchHandler): typeof fetch {
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}
