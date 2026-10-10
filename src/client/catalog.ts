/**
 * Reading the models.dev catalog document into the index the matcher walks.
 * The document arrives from a third party over HTTP, so every field is
 * validated here; one unreadable model entry is skipped and counted instead of
 * failing the whole document.
 */

import { z as zod } from 'zod'
import type { ModelsDevCatalogView, ModelsDevCost, ModelsDevModality, ModelsDevModel, ModelsDevProviderSummary } from './types.ts'

const wireModel = zod.object({
  id: zod.string().min(1),
  name: zod.string(),
  description: zod.string().optional(),
  attachment: zod.boolean().optional(),
  reasoning: zod.boolean().optional(),
  tool_call: zod.boolean().optional(),
  structured_output: zod.boolean().optional(),
  temperature: zod.boolean().optional(),
  release_date: zod.string().optional(),
  status: zod.string().optional(),
  canonical_model_id: zod.string().optional(),
  modalities: zod.object({ input: zod.array(zod.string()) }).optional(),
  limit: zod.object({ context: zod.number().optional(), output: zod.number().optional() }).optional(),
  cost: zod.object({
    input: zod.number().optional(),
    output: zod.number().optional(),
    cache_read: zod.number().optional(),
  }).optional(),
})

const wireProvider = zod.object({
  id: zod.string().min(1),
  name: zod.string().optional(),
  doc: zod.string().optional(),
  models: zod.record(zod.string(), zod.unknown()),
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
  /** Model entries grouped by models.dev provider key. */
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
 * A text-only route always accepts text; `audio`, `video`, and `pdf` have no
 * DSH spelling and are left out rather than approximated.
 */
function publishedModalities(entry: zod.infer<typeof wireModel>): readonly ModelsDevModality[] {
  const declared = entry.modalities?.input ?? []
  return declared.includes('image') ? ['text', 'image'] : ['text']
}

/** Keep only positive integer capacities, so an unpublished or zero field stays absent. */
function capacity(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Keep only a positive price, which the document publishes as a fraction as often as a whole. */
function price(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Drop unpublished prices instead of carrying an absent value as zero. */
function publishedCost(entry: zod.infer<typeof wireModel>): ModelsDevCost | undefined {
  const cost = entry.cost
  if (cost === undefined) return undefined
  const input = price(cost.input)
  const output = price(cost.output)
  const cacheRead = price(cost.cache_read)
  const view: ModelsDevCost = {
    ...input === undefined ? {} : { input },
    ...output === undefined ? {} : { output },
    ...cacheRead === undefined ? {} : { cacheRead },
  }
  return Object.keys(view).length === 0 ? undefined : view
}

/** Project one validated wire entry onto the published view. */
function publishedModel(providerId: string, entry: zod.infer<typeof wireModel>): IndexedModel {
  const contextWindow = capacity(entry.limit?.context)
  const maxOutputTokens = capacity(entry.limit?.output)
  const cost = publishedCost(entry)
  return {
    view: {
      providerId,
      id: entry.id,
      name: entry.name,
      ...entry.description === undefined ? {} : { description: entry.description },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
      inputModalities: publishedModalities(entry),
      reasoning: entry.reasoning ?? false,
      toolCall: entry.tool_call ?? false,
      structuredOutput: entry.structured_output ?? false,
      temperature: entry.temperature ?? false,
      ...entry.release_date === undefined ? {} : { releaseDate: entry.release_date },
      ...entry.status === undefined ? {} : { status: entry.status },
      ...cost === undefined ? {} : { cost },
    },
    ...entry.canonical_model_id === undefined ? {} : { canonicalId: entry.canonical_model_id },
  }
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
    throw new Error('models.dev catalog is not a JSON object of provider entries')
  }
  const byProvider = new Map<string, readonly IndexedModel[]>()
  const providers: ModelsDevProviderSummary[] = []
  const everyModel: IndexedModel[] = []
  let modelCount = 0
  let skippedCount = 0
  for (const key of Object.keys(document).sort()) {
    const parsed = wireProvider.safeParse((document as Record<string, unknown>)[key])
    if (!parsed.success) {
      skippedCount += 1
      continue
    }
    const providerId = parsed.data.id
    const models: IndexedModel[] = []
    for (const modelId of Object.keys(parsed.data.models).sort()) {
      modelCount += 1
      const entry = wireModel.safeParse(parsed.data.models[modelId])
      if (!entry.success) {
        skippedCount += 1
        continue
      }
      models.push(publishedModel(providerId, entry.data))
    }
    byProvider.set(providerId, models)
    everyModel.push(...models)
    providers.push({
      id: providerId,
      name: parsed.data.name ?? providerId,
      ...parsed.data.doc === undefined ? {} : { doc: parsed.data.doc },
      modelCount: models.length,
    })
  }
  if (providers.length === 0) {
    throw new Error('models.dev catalog published no readable provider entry')
  }
  return { source, fetchedAt, byProvider, everyModel, providers, modelCount, skippedCount }
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
