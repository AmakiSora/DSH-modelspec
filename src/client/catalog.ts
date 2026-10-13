/**
 * Reading the OpenRouter catalog document into the index the matcher walks.
 * The document arrives from a third party over HTTP, so every field is
 * validated here; one unreadable model entry is skipped and counted instead of
 * failing the whole document.
 *
 * The document is a flat model array with no provider grouping, so the index
 * groups entries by the vendor prefix of each id — `anthropic/claude-…` under
 * `anthropic` — and an id without a prefix under the `(direct)` key. The
 * published reasoning block, when a model carries one, is the only catalog
 * fact that names reasoning efforts, which is what makes the panel able to
 * declare them on a pi-ai route at all.
 */

import { z as zod } from 'zod'
import type {
  ModelsDevCatalogView, ModelsDevCost, ModelsDevModality, ModelsDevModel,
  ModelsDevProviderSummary, PublishedReasoning, ReasoningEfforts, ReasoningLevel,
} from './types.ts'
import { REASONING_LEVELS } from './types.ts'

/** The key models without a vendor prefix are grouped under. */
const DIRECT_PROVIDER = '(direct)'

const wireReasoning = zod.object({
  mandatory: zod.boolean().optional(),
  default_enabled: zod.boolean().optional(),
  supported_efforts: zod.array(zod.string()).optional(),
  default_effort: zod.string().optional(),
})

const wireModel = zod.object({
  id: zod.string().min(1),
  name: zod.string(),
  description: zod.string().optional(),
  created: zod.number().optional(),
  context_length: zod.number().optional(),
  architecture: zod.object({ input_modalities: zod.array(zod.string()) }).optional(),
  top_provider: zod.object({ max_completion_tokens: zod.number().nullable().optional() }).optional(),
  supported_parameters: zod.array(zod.string()).optional(),
  pricing: zod.object({
    prompt: zod.string().nullable().optional(),
    completion: zod.string().nullable().optional(),
    input_cache_read: zod.string().nullable().optional(),
  }).optional(),
  reasoning: wireReasoning.optional(),
})

/** A published entry plus the matching-only fields the published view omits. */
export interface IndexedModel {
  /** The view a consumer receives. */
  readonly view: ModelsDevModel
  /** Cross-provider identifier the entry publishes. */
  readonly canonicalId?: string
}

/** One validated catalog, addressable by provider key and by entry. */
export interface CatalogIndex {
  /** Address the document was read from. */
  readonly source: string
  /** Unix milliseconds the document was retrieved. */
  readonly fetchedAt: number
  /** Model entries grouped by provider key. */
  readonly byProvider: ReadonlyMap<string, readonly IndexedModel[]>
  /** Every entry in the document, in provider-key order. */
  readonly everyModel: readonly IndexedModel[]
  /** Provider rows for the catalog view. */
  readonly providers: readonly ModelsDevProviderSummary[]
  /** Model entries total, including skipped ones. */
  readonly modelCount: number
  /** Entries the document published in a form this package could not read. */
  readonly skippedCount: number
}

/**
 * Reduce the published modalities to the ones a DSH model row can declare.
 * A text-only route always accepts text; `audio`, `video`, and `file` have no
 * DSH spelling and are left out rather than approximated.
 */
function publishedModalities(entry: zod.infer<typeof wireModel>): readonly ModelsDevModality[] {
  const declared = entry.architecture?.input_modalities ?? []
  return declared.includes('image') ? ['text', 'image'] : ['text']
}

/** Keep only positive integer capacities, so an unpublished or zero field stays absent. */
function capacity(value: number | undefined | null): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Parse one published price, which the document carries as a string. */
function price(value: string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Drop unpublished prices instead of carrying an absent value as zero. */
function publishedCost(entry: zod.infer<typeof wireModel>): ModelsDevCost | undefined {
  const pricing = entry.pricing
  if (pricing === undefined) return undefined
  // The document prices per token; the panel renders per million tokens, the
  // unit every earlier catalog consumer already spoke. Six decimals absorb the
  // float noise a per-token price times a million otherwise carries.
  const million = (value: string | null | undefined): number | undefined => {
    const perToken = price(value)
    return perToken === undefined ? undefined : Number((perToken * 1_000_000).toFixed(6))
  }
  const input = million(pricing.prompt)
  const output = million(pricing.completion)
  const cacheRead = million(pricing.input_cache_read)
  const view: ModelsDevCost = {
    ...input === undefined ? {} : { input },
    ...output === undefined ? {} : { output },
    ...cacheRead === undefined ? {} : { cacheRead },
  }
  return Object.keys(view).length === 0 ? undefined : view
}

/** The capability flags the published parameter list decides. */
function publishedCapabilities(entry: zod.infer<typeof wireModel>): {
  toolCall: boolean
  structuredOutput: boolean
  temperature: boolean
  reasoning: boolean
} {
  const parameters = entry.supported_parameters ?? []
  return {
    toolCall: parameters.includes('tools'),
    structuredOutput: parameters.includes('structured_outputs'),
    temperature: parameters.includes('temperature'),
    reasoning: parameters.includes('reasoning_effort') || parameters.includes('include_reasoning'),
  }
}

/** Translate one published effort spelling to a level; `none` becomes the off level. */
function levelOf(spelling: string): ReasoningLevel | undefined {
  if (spelling === 'none') return 'off'
  return (REASONING_LEVELS as readonly string[]).includes(spelling) ? spelling as ReasoningLevel : undefined
}

/** The escalation order the levels render and index in. */
const LEVEL_ORDER = REASONING_LEVELS

/**
 * Translate the published reasoning block into the efforts a DSH entry declares.
 *
 * The levels keep the escalation order the panel renders them in, whatever
 * order the document listed them in.
 */
function publishedReasoning(entry: zod.infer<typeof wireModel>): PublishedReasoning | undefined {
  const efforts = entry.reasoning?.supported_efforts
  if (efforts === undefined) return undefined
  const levels = [...new Set(efforts.flatMap(spelling => {
    const level = levelOf(spelling)
    return level === undefined ? [] : [level]
  }))].sort((left, right) => LEVEL_ORDER.indexOf(left) - LEVEL_ORDER.indexOf(right))
  if (levels.length === 0) return undefined
  const defaultEffort = levelOf(entry.reasoning?.default_effort ?? '')
  return {
    efforts: levels,
    ...defaultEffort === undefined || !levels.includes(defaultEffort) ? {} : { defaultEffort },
  }
}

/** Project one validated wire entry onto the published view. */
function publishedModel(entry: zod.infer<typeof wireModel>): IndexedModel {
  const contextWindow = capacity(entry.context_length)
  const maxOutputTokens = capacity(entry.top_provider?.max_completion_tokens ?? undefined)
  const cost = publishedCost(entry)
  const capabilities = publishedCapabilities(entry)
  const reasoningEfforts = publishedReasoning(entry)
  const declaredEfforts = declaredEffortsOf(reasoningEfforts)
  const created = entry.created
  return {
    view: {
      providerId: vendorPrefix(entry.id),
      id: entry.id,
      name: entry.name,
      ...entry.description === undefined ? {} : { description: entry.description },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
      inputModalities: publishedModalities(entry),
      reasoning: capabilities.reasoning,
      ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
      ...declaredEfforts === undefined ? {} : { declaredEfforts },
      toolCall: capabilities.toolCall,
      structuredOutput: capabilities.structuredOutput,
      temperature: capabilities.temperature,
      ...created === undefined ? {} : { releaseDate: new Date(created * 1000).toISOString().slice(0, 10) },
      ...cost === undefined ? {} : { cost },
    },
  }
}

/** The vendor prefix of one published id, or the direct key when it has none. */
function vendorPrefix(id: string): string {
  const slash = id.indexOf('/')
  return slash <= 0 ? DIRECT_PROVIDER : id.slice(0, slash)
}

/**
 * Validate one fetched document into the index the matcher walks.
 * @param source - address the document was read from.
 * @param fetchedAt - Unix milliseconds the read completed.
 * @param document - the parsed JSON body, still untrusted.
 * @returns the index, with unreadable entries counted rather than fatal.
 * @throws Error when the body is not an object of provider entries.
 */
export function indexCatalog(source: string, fetchedAt: number, document: unknown): CatalogIndex {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('the catalog is not a JSON object')
  }
  const data = (document as Record<string, unknown>)['data']
  if (!Array.isArray(data)) {
    throw new Error('the catalog publishes no model array')
  }
  const byProvider = new Map<string, IndexedModel[]>()
  const everyModel: IndexedModel[] = []
  let modelCount = 0
  let skippedCount = 0
  for (const raw of data) {
    modelCount += 1
    const entry = wireModel.safeParse(raw)
    if (!entry.success) {
      skippedCount += 1
      continue
    }
    const indexed = publishedModel(entry.data)
    const key = indexed.view.providerId
    const group = byProvider.get(key)
    if (group === undefined) byProvider.set(key, [indexed])
    else group.push(indexed)
    everyModel.push(indexed)
  }
  if (everyModel.length === 0) {
    throw new Error('the catalog published no readable model entry')
  }
  // Sorting each group keeps two reads of one document indexing identically,
  // which the match order and the candidate list both lean on. The map itself
  // is rebuilt in key order so even its iteration agrees between reads.
  const ordered = new Map<string, IndexedModel[]>()
  for (const key of [...byProvider.keys()].sort()) {
    const group = byProvider.get(key) ?? []
    group.sort((left, right) => left.view.id.localeCompare(right.view.id))
    ordered.set(key, group)
  }
  everyModel.sort((left, right) => left.view.id.localeCompare(right.view.id))
  const providers: ModelsDevProviderSummary[] = [...ordered.entries()]
    .map(([id, models]) => ({ id, name: id, modelCount: models.length }))
  return { source, fetchedAt, byProvider: ordered, everyModel, providers, modelCount, skippedCount }
}

/**
 * Project the index onto the catalog view a consumer reads.
 * @param index - the validated catalog.
 * @returns the addressable catalog facts.
 */
export function catalogView(index: CatalogIndex): ModelsDevCatalogView {
  return {
    source: index.source,
    fetchedAt: index.fetchedAt,
    providers: index.providers,
    modelCount: index.modelCount,
    skippedCount: index.skippedCount,
  }
}

/**
 * Turn one catalog entry's published efforts into the dict a DSH model entry
 * declares.
 *
 * Every published level becomes a key carrying its own spelling — on OpenRouter
 * the effort names are the wire spellings already — except `none`, which the
 * panel writes as the `off` level with no parameter. Levels the catalog did not
 * publish stay absent, which the adapter's resolution pins unsupported; a model
 * publishing only `none` declares nothing, because an `off`-only dict is one
 * `resolveModelReasoning` refuses.
 *
 * @param published - the efforts the entry published, when it did.
 * @returns the declared dict, or `undefined` when the entry published nothing usable.
 */
export function declaredEffortsOf(published: PublishedReasoning | undefined): ReasoningEfforts | undefined {
  if (published === undefined) return undefined
  const dict: { [level in ReasoningLevel]?: string | null } = {}
  for (const level of published.efforts) {
    // A published spelling that did not narrow to a panel level — `none` above
    // all, which the view keeps as published — has no dict key to become.
    if (!(REASONING_LEVELS as readonly string[]).includes(level)) continue
    // `off` never carries a wire value: it arrives as the supported-but-send-
    // nothing spelling, and a declared `off: null` is exactly that.
    if (level === 'off') continue
    dict[level] = level
  }
  // A dict offering no level beyond `off` is one the adapter's resolution
  // refuses, so an entry that published nothing but `none` declares nothing.
  if (Object.keys(dict).length === 0) return undefined
  return { ...dict, off: null } as ReasoningEfforts
}
