/**
 * Adding one model to a route the deployment declared. Three things live here:
 * the template a dialog fills when the catalog published nothing to adopt, the
 * edit that appends the entry to the namespace, and the checks that keep a
 * draft the adapter would refuse out of the write.
 *
 * The write is a single path-addressed `set` at the first index past the end of
 * the namespace's `models` array, which is how the settings document appends:
 * an index one past the last element is accepted only when the op addresses the
 * element itself rather than a field inside one.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ModelsDevModality } from './types.ts'
import type { ConfiguredRoute, ModalityField } from './configured.ts'

/** The values one new model entry is written from. */
export interface NewModelEntry {
  /** Model id the provider accepts. */
  readonly id: string
  /** Display name, when the entry declares one. */
  readonly name?: string
  /** Combined context, when the entry declares one. */
  readonly contextWindow?: number
  /** Output cap, when the entry declares one. */
  readonly maxTokens?: number
  /** Accepted modalities; `text` is always one of them. */
  readonly inputModalities: readonly ModelsDevModality[]
  /**
   * Field name this namespace family stores modalities under. Absent leaves the
   * field out of the entry entirely, so the adapter's own default applies —
   * the panel never guesses which of the two spellings a route uses.
   */
  readonly modalityField?: ModalityField
}

/** The values a dialog fills when the catalog published no entry to adopt. */
export interface NewModelTemplate {
  /** Combined context, when the donor model declared one. */
  readonly contextWindow?: number
  /** Output cap, when the donor model declared one. */
  readonly maxTokens?: number
  /** Accepted modalities of the donor model; `text` when it declared none. */
  readonly inputModalities: readonly ModelsDevModality[]
  /** Field name the route's namespace family stores modalities under. */
  readonly modalityField?: ModalityField
}

/** Why one draft cannot be written into a route. */
export type NewModelProblem = 'empty-id' | 'duplicate-id' | 'invalid-context' | 'invalid-output'

/**
 * Fill a dialog from the route's own configuration.
 *
 * A model models.dev has never heard of is still a model a user may want, and
 * the one thing the deployment itself already answers is what a model on this
 * route looks like. The donor is the last configured model that declares a
 * capacity, so a route that has since grown a smaller model does not donate its
 * smallest one; a route whose models declare no capacity at all still donates
 * the family its namespace stores modalities under.
 *
 * @param route - the route the model is being added to.
 * @returns the capacities, modalities, and field name to start from.
 */
export function newModelTemplate(route: ConfiguredRoute): NewModelTemplate {
  const donor = [...route.models].reverse()
    .find(model => model.contextWindow !== undefined || model.maxTokens !== undefined)
    ?? route.models[route.models.length - 1]
  if (donor === undefined) return { inputModalities: ['text'] }
  return {
    ...donor.contextWindow === undefined ? {} : { contextWindow: donor.contextWindow },
    ...donor.maxTokens === undefined ? {} : { maxTokens: donor.maxTokens },
    // An entry that declares an empty modality list inherits the route's, so
    // the template names `text` rather than starting the new entry at nothing.
    inputModalities: donor.inputModalities.length === 0 ? ['text'] : [...donor.inputModalities],
    ...donor.modalityField === undefined ? {} : { modalityField: donor.modalityField },
  }
}

/**
 * Build the edit that appends one new model entry to a route.
 *
 * The address is the namespace's own array length, not the number of rows this
 * panel could read: an entry carrying no readable id still occupies an index,
 * and appending at the readable count would overwrite it.
 *
 * @param route - the provider route whose namespace holds the models.
 * @param entry - the values to write.
 * @returns one `set` op addressing the first free array index.
 */
export function addModelOps(route: ConfiguredRoute, entry: NewModelEntry): SettingsPathOpView[] {
  const value: Record<string, JsonValue> = { id: entry.id.trim() }
  const name = entry.name?.trim()
  if (name !== undefined && name !== '') value['name'] = name
  if (entry.contextWindow !== undefined) value['contextWindow'] = entry.contextWindow
  if (entry.maxTokens !== undefined) value['maxTokens'] = entry.maxTokens
  if (entry.modalityField !== undefined) value[entry.modalityField] = [...entry.inputModalities]
  return [{ op: 'set', path: [...route.settingsPath, 'models', String(route.arrayLength)], value }]
}

/** Whether a capacity is one both adapters accept: a positive integer. */
function badCapacity(value: number | undefined): boolean {
  return value !== undefined && !(Number.isInteger(value) && value > 0)
}

/**
 * Check one draft against what the route already holds.
 *
 * Each adapter refuses a duplicate model id inside one route and a capacity
 * that is not a positive integer, so both refusals are answered here rather
 * than by a namespace rejection the reader would only see afterwards.
 *
 * @param route - the route the model is being added to.
 * @param entry - the draft to check.
 * @returns the first problem that stops it, or `undefined` when it can be written.
 */
export function newModelProblem(route: ConfiguredRoute, entry: NewModelEntry): NewModelProblem | undefined {
  const id = entry.id.trim()
  if (id === '') return 'empty-id'
  if (route.models.some(model => model.id === id)) return 'duplicate-id'
  if (badCapacity(entry.contextWindow)) return 'invalid-context'
  if (badCapacity(entry.maxTokens)) return 'invalid-output'
  return undefined
}