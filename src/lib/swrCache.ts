// Session-scoped stale-while-revalidate cache for the client data hooks.
// A filter combo the user already viewed renders instantly from here while the
// hook refetches in the background — flipping store/period back and forth stops
// costing a full round trip each time. Module-level, so it survives page
// navigation within the SPA but resets on hard reload.
const store = new Map<string, unknown>()

export function swrGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function swrSet(key: string, value: unknown): void {
  store.set(key, value)
}
