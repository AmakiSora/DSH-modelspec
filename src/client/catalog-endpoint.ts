/**
 * Where this browser reads the catalog from, kept beside the panel.
 *
 * The panel reads the catalog from the browser itself, so a network that
 * cannot reach the published endpoint is one the deployment's configuration
 * cannot fix: the fetch belongs to this origin, not to the Host. The address
 * is therefore a panel preference, like the entry bindings are — stored in
 * this browser's local storage, scoped by host, and read before every catalog
 * fetch.
 *
 * An override replaces the endpoint outright rather than decorating it, which
 * is what keeps every shape addressable: a mirror that serves the same
 * document at another origin, or a CORS proxy whose URL carries the target —
 * `https://proxy.example/?url=` followed by the encoded endpoint — both work
 * by being the address the fetch is pointed at.
 */

/** The storage key, namespaced by host so two deployments on one browser differ. */
const KEY_PREFIX = 'dsh-modelspec/catalog-endpoint/'

/** The endpoint the panel reads when no override is stored. */
export const DEFAULT_CATALOG_ENDPOINT = 'https://openrouter.ai/api/v1/models'

/** This browser's session overrides, filed by host like the storage is. */
const fallback = new Map<string, string>()

/** This browser's storage, or `null` when it has none. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Read the catalog address this browser overrides the default with.
 *
 * Storage is the authority: a stored file — including an empty one, which
 * means the reader cleared the override — answers the question outright, and
 * the session copy is consulted only where storage is absent or refused, the
 * situations the file cannot speak for.
 *
 * @param host - the host the override belongs to.
 * @returns the stored address, or `undefined` when none is kept.
 */
export function readCatalogEndpoint(host: string): string | undefined {
  const store = storage()
  let raw: string | null | undefined
  if (store !== null) {
    try {
      raw = store.getItem(KEY_PREFIX + host)
    } catch {
      raw = undefined
    }
    if (raw !== undefined && raw !== null) return raw.trim() === '' ? undefined : raw
    if (raw === null) return undefined
  }
  return fallback.get(host)
}

/**
 * File the catalog address this browser reads from, or take the override back.
 * @param host - the host the override belongs to.
 * @param endpoint - the address to store, or `undefined` to restore the default.
 */
export function writeCatalogEndpoint(host: string, endpoint: string | undefined): void {
  const store = storage()
  try {
    if (endpoint === undefined) {
      store?.removeItem(KEY_PREFIX + host)
    } else {
      store?.setItem(KEY_PREFIX + host, endpoint)
    }
  } catch {
    // A refused quota leaves the session override to answer for it.
  }
  if (endpoint === undefined) fallback.delete(host)
  else fallback.set(host, endpoint)
}
