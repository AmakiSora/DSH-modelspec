/**
 * Locating a configured provider route and model inside the models.dev
 * catalog. Every step is a pure comparison over one validated index, so the
 * resolution order below is the whole matching contract.
 */

import type { CatalogIndex, IndexedModel } from './catalog.ts'
import type {
  ModelsDevCandidate, ModelsDevMatch, ModelsDevMatchStrategy, ModelsDevModel, ModelsDevSimilar, ModelsDevSimilarity,
} from './types.ts'

/** One comparison that located an entry, or the absence of one. */
export interface ModelLookup {
  /** The entry the comparison located; absent when nothing matched. */
  readonly model?: IndexedModel
  /** Which comparison located it; `none` when nothing matched. */
  readonly strategy: ModelsDevMatchStrategy
}

/** Deployment provider keys mapped onto models.dev provider keys. */
export type ProviderAliases = Readonly<Record<string, string>>

/**
 * One comparison offered against an entry, and the strategy it reports when it
 * is the first to accept.
 */
interface Comparison {
  /** Whether this comparison accepts the entry for the requested model id. */
  readonly accepts: (entry: IndexedModel) => boolean
  /** Strategy reported when this comparison accepts an entry. */
  readonly strategy: Exclude<ModelsDevMatchStrategy, 'none'>
  /**
   * Whether the comparison is precise enough to run across every provider.
   * Dropping a vendor prefix reads well inside one provider and matches an
   * unrelated model elsewhere, so it is offered only there.
   */
  readonly providerScoped: boolean
}

/** Lower-case the key and fold `_` onto the `-` that models.dev provider ids use. */
function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-')
}

/**
 * Fold a model id to the form two spellings of one model share. A dated
 * release differs from its family only by this trailing segment, so
 * `claude-opus-4-7-20260101` still folds onto `claude-opus-4-7` while
 * `gpt-4-turbo`, whose suffix is not a date, is left alone.
 */
function normalizeId(value: string): string {
  const folded = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return folded.replace(/-(\d{4}|\d{6}|\d{8})$/, '')
}

/** The id after its vendor prefix, as a gateway publishes a foreign model. */
function bareId(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

/**
 * Build the comparisons for one requested model id, in the order they are
 * tried: the id verbatim, the entry's cross-provider id, the id without its
 * vendor prefix, and the folded id.
 */
function comparisonsFor(modelId: string): readonly Comparison[] {
  const wanted = modelId.trim()
  const folded = normalizeId(modelId)
  const bare = (value: string | undefined): boolean => value !== undefined && bareId(value) === wanted
  return [
    { accepts: entry => entry.view.id === wanted, strategy: 'exact', providerScoped: true },
    { accepts: entry => entry.canonicalId === wanted, strategy: 'canonical', providerScoped: true },
    { accepts: entry => bare(entry.view.id) || bare(entry.canonicalId), strategy: 'bare', providerScoped: false },
    {
      accepts: entry => folded !== ''
        && (normalizeId(entry.view.id) === folded
          || (entry.canonicalId !== undefined && normalizeId(entry.canonicalId) === folded)),
      strategy: 'normalized',
      providerScoped: true,
    },
  ]
}

/**
 * Resolve the models.dev provider key for one deployment route key.
 *
 * Candidates are tried in a fixed order: the route key itself, any configured
 * alias, then the route key with leading segments dropped and with trailing
 * segments dropped. A deployment route may name its vendor and product
 * (`deepseek-official`), one product alone (`google-gemini`), or neither
 * (`my-gateway`), so both segment directions are tried and a candidate naming
 * no provider is skipped rather than accepted.
 *
 * @param index - the validated catalog.
 * @param routeKey - the deployment's provider route key.
 * @param aliases - deployment provider keys mapped onto models.dev provider keys.
 * @returns the models.dev provider key, or `undefined` when none matches.
 */
export function resolveProviderKey(index: CatalogIndex, routeKey: string, aliases: ProviderAliases): string | undefined {
  const normalized = normalizeKey(routeKey)
  if (normalized === '') return undefined
  const known = (candidate: string): boolean => index.byProvider.has(candidate)
  if (known(normalized)) return normalized
  const aliased = aliases[normalized]
  if (aliased !== undefined) {
    const target = normalizeKey(aliased)
    if (known(target)) return target
  }
  const segments = normalized.split('-')
  for (let dropped = 1; dropped < segments.length; dropped += 1) {
    if (known(segments.slice(dropped).join('-'))) return segments.slice(dropped).join('-')
  }
  for (let dropped = 1; dropped < segments.length; dropped += 1) {
    if (known(segments.slice(0, segments.length - dropped).join('-'))) return segments.slice(0, segments.length - dropped).join('-')
  }
  return undefined
}

/**
 * Locate one model id inside one set of catalog entries.
 * @param entries - candidate entries, already narrowed to one provider when there is one.
 * @param modelId - the configured model id.
 * @param providerScoped - whether entries came from a resolved provider, which also offers the looser comparison.
 * @returns the located entry and the comparison that located it.
 */
export function lookupModel(entries: readonly IndexedModel[], modelId: string, providerScoped: boolean): ModelLookup {
  for (const comparison of comparisonsFor(modelId)) {
    if (!providerScoped && !comparison.providerScoped) continue
    const found = entries.find(comparison.accepts)
    if (found !== undefined) return { model: found, strategy: comparison.strategy }
  }
  return { strategy: 'none' }
}

/**
 * Locate one model id inside the resolved provider and, when that provider
 * publishes no such id, once more across every other provider with the
 * comparisons precise enough to be unambiguous without provider context.
 */
function locate(index: CatalogIndex, providerKey: string | undefined, modelId: string): ModelLookup {
  const scoped = lookupModel(index.byProvider.get(providerKey ?? '') ?? [], modelId, true)
  if (scoped.model !== undefined) return scoped
  return lookupModel(index.everyModel, modelId, false)
}

/**
 * Match one configured provider route and model against the catalog.
 * @param index - the validated catalog.
 * @param provider - the deployment's provider route key.
 * @param modelId - the configured model id.
 * @param aliases - deployment provider keys mapped onto models.dev provider keys.
 * @returns the route's resolved provider key, the located entry, and the comparison that located it.
 */
export function matchModel(index: CatalogIndex, provider: string, modelId: string, aliases: ProviderAliases): ModelsDevMatch {
  const routeProviderKey = resolveProviderKey(index, provider, aliases)
  const located = locate(index, routeProviderKey, modelId)
  const model: ModelsDevModel | undefined = located.model?.view
  return {
    provider,
    modelId,
    ...routeProviderKey === undefined ? {} : { routeProviderKey },
    ...model === undefined ? {} : { providerKey: model.providerId },
    strategy: located.strategy,
    ...model === undefined ? {} : { model },
  }
}

/**
 * Collect every entry the comparisons accept, stopping at the first comparison
 * that accepts anything. The precedence is the one `locate` walks, so a
 * candidate list never widens a question a single match would have narrowed: a
 * loose comparison is only reached once the precise ones found nothing.
 * @param entries - candidate entries, already narrowed to one provider when there is one.
 * @param comparisons - the comparisons to offer, in order.
 * @returns the located entries and the comparison that located them.
 */
function collect(
  entries: readonly IndexedModel[],
  comparisons: readonly Comparison[],
): { readonly entries: readonly IndexedModel[]; readonly strategy: Exclude<ModelsDevMatchStrategy, 'none'> } | undefined {
  for (const comparison of comparisons) {
    const accepted = entries.filter(comparison.accepts)
    if (accepted.length > 0) return { entries: accepted, strategy: comparison.strategy }
  }
  return undefined
}

/** Project located entries onto the candidates a chooser offers. */
function candidatesOf(
  located: NonNullable<ReturnType<typeof collect>>,
): ModelsDevCandidate[] {
  return located.entries.map(entry => ({ providerId: entry.view.providerId, model: entry.view, strategy: located.strategy }))
}

/**
 * Locate every catalog entry that answers to one model id on one route.
 *
 * A single match is what {@link matchModel} reports, which is all comparing an
 * already-stored model needs. Adding one is a different question: an id can
 * legitimately be published by several providers, or reach several entries of
 * one provider through a folded comparison, and only the user knows which of
 * them the route means.
 *
 * Entries are offered in the order the comparisons would reach them — the
 * resolved provider first, then every provider — so the first candidate is the
 * answer a single match would have returned.
 *
 * @param index - the validated catalog.
 * @param provider - the deployment's provider route key.
 * @param modelId - the model id being added.
 * @param aliases - deployment provider keys mapped onto models.dev provider keys.
 * @returns every located entry with the comparison that located it; empty when nothing matched.
 */
export function matchCandidates(
  index: CatalogIndex,
  provider: string,
  modelId: string,
  aliases: ProviderAliases,
): ModelsDevCandidate[] {
  const comparisons = comparisonsFor(modelId)
  const precise = comparisons.filter(comparison => comparison.providerScoped)
  const loose = comparisons.filter(comparison => !comparison.providerScoped)
  const scoped = index.byProvider.get(resolveProviderKey(index, provider, aliases) ?? '') ?? []
  for (const entries of [scoped, index.everyModel]) {
    const located = collect(entries, precise)
    if (located !== undefined) return candidatesOf(located)
  }
  const elsewhere = collect(index.everyModel, loose)
  return elsewhere === undefined ? [] : candidatesOf(elsewhere)
}

/** How many entries one fuzzy search offers. */
export const DEFAULT_SIMILAR_LIMIT = 20

/**
 * How far a fuzzy search may reach, by how long the id being searched for is.
 *
 * The budget is what keeps a short id from matching half the catalog: one edit
 * on a four-character id reaches almost anything, so the shortest ids get none
 * and still match by containment alone.
 * @param length - length of the folded id being searched for.
 * @returns the largest edit distance worth offering.
 */
function editBudget(length: number): number {
  if (length <= 4) return 0
  return length <= 8 ? 1 : 2
}

/** One more than any distance a search will offer, so a refusal is unambiguous. */
const TOO_FAR = 99

/**
 * Read one cell of a rolling distance row.
 *
 * Both rows are built left to right and the loop only ever reads a column the
 * previous iteration wrote, so the value is always there; the fallback keeps a
 * hypothetical hole from turning into a silently wrong distance.
 *
 * @param row - one built row.
 * @param column - the column to read.
 * @returns the cell, or an unreachable cost.
 */
function cell(row: readonly number[], column: number): number {
  return row[column] ?? Number.POSITIVE_INFINITY
}

/**
 * Count the single-character edits between two folded ids.
 *
 * The row minimum is a lower bound on the whole distance — any alignment from
 * the start to the end crosses this row once, at some column — so a row that
 * bottoms out past the budget abandons the comparison instead of finishing it.
 *
 * @param left - the first folded id.
 * @param right - the second folded id.
 * @param budget - the largest distance the caller still cares about.
 * @returns the distance, or `TOO_FAR` when it exceeds the budget.
 */
function editDistance(left: string, right: string, budget: number): number {
  if (left === right) return 0
  if (budget === 0 || Math.abs(left.length - right.length) > budget) return TOO_FAR
  // The shorter id indexes the rows, so the rolling pair stays as small as the
  // longer of the two allows and the early exit has the most room to fire.
  const [rows, columns] = left.length <= right.length ? [left, right] : [right, left]
  let previous = Array.from({ length: columns.length + 1 }, (_unused, index) => index)
  let reached = 0
  for (let row = 1; row <= rows.length; row += 1) {
    const current = [row]
    let lowest = row
    for (let column = 1; column <= columns.length; column += 1) {
      const cost = rows.charAt(row - 1) === columns.charAt(column - 1) ? 0 : 1
      const value = Math.min(cell(current, column - 1) + 1, cell(previous, column) + 1, cell(previous, column - 1) + cost)
      current.push(value)
      reached = value
      if (value < lowest) lowest = value
    }
    if (lowest > budget) return TOO_FAR
    previous = current
  }
  // The last cell of the last row is the distance itself; carrying it out of the
  // loop avoids reading past the rolling array's typed bounds. The early exit is
  // only a cheap filter — a row minimum sits at zero for as long as some prefix
  // matches — so the finished distance still has to answer to the budget.
  return reached > budget ? TOO_FAR : reached
}

/** One entry a fuzzy search located, kept with what it took to reach it. */
interface Scored {
  /** The entry itself. */
  readonly entry: IndexedModel
  /** How the entry came to be offered. */
  readonly similarity: ModelsDevSimilarity
  /** Character edits, for a `near` match. */
  readonly distance: number
  /** The provider the route resolved to, which breaks ties towards itself. */
  readonly preferred: boolean
}

/** The folded spellings one entry answers to: its id and its cross-provider id. */
function foldingsOf(entry: IndexedModel): string[] {
  return [normalizeId(entry.view.id), entry.canonicalId === undefined ? '' : normalizeId(entry.canonicalId)]
}

/**
 * Offer every entry whose id came close to one the user typed.
 *
 * The comparisons all require an exact relationship, so a mistyped character,
 * a truncated paste, or a dated variant leaves a model with no candidate at all.
 * This asks a looser question — which published ids are near this one — and
 * answers with the closeness attached, so the reader can see why each entry was
 * offered instead of guessing which one the panel meant.
 *
 * @param index - the validated catalog.
 * @param provider - the deployment's provider route key, used to break ties.
 * @param modelId - the id being searched for.
 * @param aliases - deployment provider keys mapped onto models.dev provider keys.
 * @param limit - the most entries to offer.
 * @returns the closest entries, nearest first.
 */
export function similarCandidates(
  index: CatalogIndex,
  provider: string,
  modelId: string,
  aliases: ProviderAliases,
  limit: number = DEFAULT_SIMILAR_LIMIT,
): ModelsDevSimilar[] {
  const wanted = normalizeId(modelId)
  if (wanted === '') return []
  const budget = editBudget(wanted.length)
  const routeProviderKey = resolveProviderKey(index, provider, aliases)
  const scored: Scored[] = []
  for (const entry of index.everyModel) {
    let best: Scored | undefined
    for (const folded of foldingsOf(entry)) {
      if (folded === '') continue
      let found: Scored
      if (folded === wanted) found = { entry, similarity: 'folded', distance: 0, preferred: entry.view.providerId === routeProviderKey }
      else if (folded.includes(wanted) || wanted.includes(folded)) {
        found = { entry, similarity: 'contains', distance: TOO_FAR, preferred: entry.view.providerId === routeProviderKey }
      } else {
        const distance = editDistance(wanted, folded, budget)
        if (distance === TOO_FAR) continue
        found = { entry, similarity: 'near', distance, preferred: entry.view.providerId === routeProviderKey }
      }
      if (best === undefined || rank(found) < rank(best)) best = found
    }
    if (best !== undefined) scored.push(best)
  }
  scored.sort((left, right) => rank(left) - rank(right)
    || left.distance - right.distance
    || Number(right.preferred) - Number(left.preferred)
    || left.entry.view.providerId.localeCompare(right.entry.view.providerId)
    || left.entry.view.id.localeCompare(right.entry.view.id))
  return scored.slice(0, limit).map(({ entry, similarity, distance }) => ({
    providerId: entry.view.providerId,
    model: entry.view,
    similarity,
    ...similarity === 'near' ? { distance } : {},
  }))
}

/**
 * Order the three ways an entry can be close. Containment outranks a typo
 * because one id being inside another names a real relationship — a variant of
 * the same family — while two edits could be two unrelated models that merely
 * look alike.
 * @param scored - the located entry.
 * @returns its rank, lower being closer.
 */
function rank(scored: Scored): number {
  if (scored.similarity === 'folded') return 0
  if (scored.similarity === 'contains') return 1
  return 2
}
