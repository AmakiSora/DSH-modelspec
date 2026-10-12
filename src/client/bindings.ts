/**
 * Which catalog entry one configured model follows, remembered in this browser.
 *
 * A binding answers a question the id alone cannot: a gateway route serving a
 * model several providers publish under the same id, or a mistyped id whose
 * nearest entry is not the one the deployment meant. The panel cannot store that
 * answer in the deployment's configuration — a settings write is validated
 * against the adapter's own schema, which declares no field for it — so it is
 * kept beside the panel instead.
 *
 * It is therefore a panel preference, not deployment configuration: it says what
 * to compare against, never what to write. Nothing here reaches a namespace, and
 * the values themselves always come from the catalog entry or from the reader.
 */

/** One model's pinned catalog entry. */
export interface EntryBinding {
  /** models.dev provider that publishes the entry. */
  readonly providerId: string
  /** Model id the entry is published under. */
  readonly modelId: string
}

/** Every binding this browser holds, by the key that names its model. */
export type Bindings = ReadonlyMap<string, EntryBinding>

/** The storage key, namespaced by host so two deployments on one browser differ. */
const KEY_PREFIX = 'dsh-modelspec/bindings/'

/**
 * The prefix this panel filed bindings under before it was renamed. A browser
 * that pinned entries under the old name still holds them, and reading an empty
 * file instead would look exactly like "nothing was ever pinned", so the old
 * file is consulted whenever the new one is absent. Nothing is written there
 * again: the next write carries every entry forward under the new prefix.
 */
const LEGACY_KEY_PREFIX = 'model-aid/bindings/'

/**
 * Fallback for a browser that offers no storage — a private window with it
 * turned off, or the node the specs run in. The panel still works for the
 * session; the bindings simply do not outlive it.
 *
 * Filed by host like the storage is, because one browser talks to more than one
 * deployment and a session that cannot persist must not leak one host's answers
 * into another's.
 */
const fallback = new Map<string, Map<string, EntryBinding>>()

/** This host's session bindings. */
function session(host: string): Map<string, EntryBinding> {
  const existing = fallback.get(host)
  if (existing !== undefined) return existing
  const created = new Map<string, EntryBinding>()
  fallback.set(host, created)
  return created
}

/**
 * This browser's storage, or `null` when it has none.
 *
 * Storage can be present and still refuse: Safari's private mode throws on
 * write rather than omitting the object, so the access itself is guarded.
 *
 * @returns the storage to use, or `null`.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The key one model's binding is filed under.
 *
 * A route key plus a model id, not the model's position in the array, so
 * reordering the namespace does not silently re-point every binding. Neither
 * part carries a NUL, and neither can contain one from configuration.
 *
 * @param routeKey - the route's panel key.
 * @param modelId - the model id the deployment configured.
 * @returns the key.
 */
export function bindingKey(routeKey: string, modelId: string): string {
  return `${routeKey}\u0000${modelId}`
}

/**
 * Read one storage entry, or `undefined` when it is absent or unreadable.
 * @param store - the browser's storage.
 * @param prefix - the file prefix to look under.
 * @param host - the host the bindings belong to.
 * @returns the file's parsed contents, or `undefined`.
 */
function readFile(store: Storage, prefix: string, host: string): Record<string, unknown> | undefined {
  let raw: string | null
  try {
    raw = store.getItem(prefix + host)
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/**
 * Read every binding this browser holds.
 *
 * A file that has been edited by hand, or written by another version of this
 * panel, is discarded whole rather than half-applied: a binding this panel
 * cannot read is one it would overwrite on the next change anyway. The file
 * this panel wrote before it was renamed is consulted only when the current
 * one is absent, so a rename cannot quietly unpin everything a reader chose.
 *
 * @param host - the host the bindings belong to.
 * @returns every binding, empty when there are none or they are unreadable.
 */
export function readBindings(host: string): Bindings {
  const store = storage()
  if (store === null) return session(host)
  const file = readFile(store, KEY_PREFIX, host) ?? readFile(store, LEGACY_KEY_PREFIX, host)
  if (file === undefined) return session(host)
  const bindings = new Map<string, EntryBinding>()
  for (const [key, value] of Object.entries(file)) {
    if (typeof value !== 'object' || value === null) continue
    const { providerId, modelId } = value as { providerId?: unknown; modelId?: unknown }
    if (typeof providerId === 'string' && providerId !== '' && typeof modelId === 'string' && modelId !== '') {
      bindings.set(key, { providerId, modelId })
    }
  }
  return bindings
}

/**
 * File one model's binding, or take it back.
 *
 * The whole file is rewritten because the panel holds every binding in one
 * place; a per-key write would need the same read-modify-write under a name the
 * storage API does not offer.
 *
 * @param host - the host the bindings belong to.
 * @param key - the model's binding key.
 * @param binding - the entry to pin, or `undefined` to follow the id again.
 */
export function writeBinding(host: string, key: string, binding: EntryBinding | undefined): void {
  const bindings = new Map(readBindings(host))
  if (binding === undefined) bindings.delete(key)
  else bindings.set(key, binding)
  // The session copy is written whether or not the file can be, so a storage
  // that refuses mid-session leaves the panel coherent until the next reload
  // rather than losing a binding the reader just chose.
  const kept = session(host)
  kept.clear()
  for (const [each, value] of bindings) kept.set(each, value)
  const store = storage()
  if (store === null) return
  try {
    store.setItem(KEY_PREFIX + host, JSON.stringify(Object.fromEntries(bindings)))
  } catch {
    // A full or refused quota leaves the session's bindings to answer for it;
    // the next reload starts clean.
  }
}

/**
 * The host this browser is talking to, which scopes the bindings beside it.
 *
 * @returns the origin the panel was served from, or an empty string where there
 * is no window to ask.
 */
export function bindingHost(): string {
  return globalThis.location?.host ?? ''
}