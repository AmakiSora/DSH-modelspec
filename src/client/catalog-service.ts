/**
 * The browser-side catalog: reads the published document from an address the
 * catalog serves with open CORS, holds the indexed result for a configured
 * lifetime, and matches configured provider routes and models against it.
 */

import { catalogView, indexCatalog, type CatalogIndex } from './catalog.ts'
import { matchBound, matchCandidates, matchModel, similarCandidates, DEFAULT_SIMILAR_LIMIT, type ProviderAliases } from './match.ts'
import type { ModelsDevCandidate, ModelsDevCatalogView, ModelsDevLookup, ModelsDevMatch, ModelsDevSimilar } from './types.ts'

/** The address the catalog publishes its machine-readable document at. */
export const CATALOG_ENDPOINT = 'https://openrouter.ai/api/v1/models'

/** How long a retrieved catalog is served before it is read again. */
export const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** How long one catalog read may take before it is abandoned. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** What one failed read reports. */
export class ModelsDevError extends Error {
  /**
   * @param message - human diagnostic carried to the panel.
   * @param source - address the read was attempted against.
   * @param options - standard Error options.
   */
  constructor(message: string, readonly source: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ModelsDevError'
  }
}

/**
 * Read, hold, and match the catalog in one browser.
 *
 * One retrieval is in flight at a time: every caller that arrives while a read
 * runs waits on it. A failed read holds nothing, so the next caller retries.
 */
export class ModelsDevCatalog {
  /** The catalog currently held, or `undefined` before the first successful read. */
  private held: CatalogIndex | undefined

  /** The read in flight, shared by every caller that arrives while it runs. */
  private reading: Promise<CatalogIndex> | undefined

  /**
   * @param options - deployment choices; every field has a default.
   */
  constructor(
    private readonly endpoint: string = CATALOG_ENDPOINT,
    private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly providerAliases: ProviderAliases = {},
  ) {}

  /** The address this catalog reads from. */
  get source(): string {
    return this.endpoint
  }

  /**
   * Read the catalog facts the panel renders from.
   * @param refresh - whether to read again instead of serving the held copy.
   * @returns the address, retrieval time, provider rows, and entry counts.
   * @throws {ModelsDevError} when the document cannot be read or parsed.
   */
  async view(refresh = false): Promise<ModelsDevCatalogView> {    if (refresh) this.held = undefined
    return catalogView(await this.index())
  }

  /**
   * Match configured provider routes and models against the catalog.
   *
   * A lookup carrying a binding is answered by that entry, so one call still
   * covers the whole page whether or not this browser pinned any of its models.
   *
   * @param lookups - provider route keys, model ids, and any pinned entries.
   * @returns one result per lookup, carrying the resolved provider keys and the located entry.
   * @throws {ModelsDevError} when the document cannot be read or parsed.
   */
  async match(lookups: readonly ModelsDevLookup[]): Promise<ModelsDevMatch[]> {
    const index = await this.index()
    return lookups.map(lookup =>
      lookup.binding === undefined
        ? matchModel(index, lookup.provider, lookup.modelId, this.providerAliases)
        : matchBound(index, lookup.provider, lookup.modelId, lookup.binding, this.providerAliases))
  }

  /**
   * Locate every entry that answers to one model id, rather than only the first.
   *
   * A comparison answers "what does the catalog say about this model", which
   * one entry settles. Adding a model asks a different question — "which of the
   * entries carrying this id do you mean" — so an ambiguous id has to reach the
   * reader as a list instead of an arbitrary winner.
   *
   * @param provider - the deployment's provider route key.
   * @param modelId - the model id being added.
   * @returns every located entry, best comparison first; empty when nothing matched.
   * @throws {ModelsDevError} when the document cannot be read or parsed.
   */
  async candidates(provider: string, modelId: string): Promise<ModelsDevCandidate[]> {
    return matchCandidates(await this.index(), provider, modelId, this.providerAliases)
  }

  /**
   * Locate every entry whose id came close to one model id.
   *
   * The comparisons behind {@link match} all require an exact relationship, so
   * one mistyped character leaves the model with nothing at all. This is the
   * reader asking "what did I mean" rather than "what does the catalog say", so
   * it walks the whole document and answers with each entry's closeness.
   *
   * @param provider - the deployment's provider route key, used to break ties.
   * @param modelId - the id as typed.
   * @param limit - the most entries to offer.
   * @returns the closest entries, nearest first.
   * @throws {ModelsDevError} when the document cannot be read or parsed.
   */
  async similar(provider: string, modelId: string, limit?: number): Promise<ModelsDevSimilar[]> {
    return similarCandidates(await this.index(), provider, modelId, this.providerAliases, limit ?? DEFAULT_SIMILAR_LIMIT)
  }

  /**
   * Hold the catalog while it is within its lifetime, and otherwise start one
   * read that every concurrent caller waits on.
   * @returns the validated catalog.
   * @throws {ModelsDevError} when the document cannot be read or parsed.
   */
  private index(): Promise<CatalogIndex> {
    const held = this.held
    if (held !== undefined && Date.now() - held.fetchedAt < this.cacheTtlMs) return Promise.resolve(held)
    const reading = this.reading ?? this.read()
    return reading
  }

  /** Read the document once, index it, and hold it for its lifetime. */
  private read(): Promise<CatalogIndex> {
    const reading = this.fetchCatalog().then((index) => {
      this.held = index
      return index
    }).finally(() => {
      if (this.reading === reading) this.reading = undefined
    })
    this.reading = reading
    return reading
  }

  /**
   * Read the configured address and validate the body.
   * @returns the validated catalog.
   * @throws {ModelsDevError} for a transport failure, a non-2xx answer, or an unusable document.
   */
  private async fetchCatalog(): Promise<CatalogIndex> {
    try {
      const response = await fetch(this.endpoint, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`)
      return indexCatalog(this.endpoint, Date.now(), await response.json() as unknown)
    } catch (error: unknown) {
      throw new ModelsDevError(
        `could not read the catalog: ${error instanceof Error ? error.message : String(error)}`,
        this.endpoint,
        { cause: error },
      )
    }
  }
}
