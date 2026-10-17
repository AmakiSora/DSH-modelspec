/**
 * Comparing one configured model against its catalog entry, and turning the
 * result into the path-addressed edits the namespace accepts. Only a value the
 * catalog publishes is ever adopted: an unpublished field leaves the
 * deployment's own configuration alone.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsDevMatch, ModelsDevModality, ReasoningEfforts } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ConfiguredModel, ConfiguredRoute, ModalityField } from './configured.ts'
import { sameEfforts, sameModalities } from './draft.ts'

/**
 * Stored field a difference is about. The two modality field names are both
 * included because a namespace names its own: whichever family declared the
 * entry is the field a write addresses.
 */
export type DifferenceField = 'contextWindow' | 'maxTokens' | ModalityField | 'reasoningEfforts'

/** One stored field whose value differs from the catalog entry. */
export interface FieldDifference {
  /** Stored field the difference is about. */
  readonly field: DifferenceField
  /** Value the deployment stores, or `undefined` when the entry declares none. */
  readonly configured: number | readonly ModelsDevModality[] | ReasoningEfforts | undefined
  /** Value the catalog publishes for it. */
  readonly published: number | readonly ModelsDevModality[] | ReasoningEfforts
}

/** Whether one difference is about the accepted modalities. */
export function isModalityDifference(difference: FieldDifference): boolean {
  return difference.field === 'input' || difference.field === 'inputModalities'
}

/**
 * List the stored fields one configured model holds at a value the catalog
 * entry contradicts.
 * @param model - the configured model entry.
 * @param match - what the catalog says about that route and model id.
 * @returns the differences, in the order the panel renders them.
 */
export function compareModel(model: ConfiguredModel, match: ModelsDevMatch): FieldDifference[] {
  const published = match.model
  if (published === undefined) return []
  const differences: FieldDifference[] = []
  if (published.contextWindow !== undefined && published.contextWindow !== model.contextWindow) {
    differences.push({ field: 'contextWindow', configured: model.contextWindow, published: published.contextWindow })
  }
  if (published.maxOutputTokens !== undefined && published.maxOutputTokens !== model.maxTokens) {
    differences.push({ field: 'maxTokens', configured: model.maxTokens, published: published.maxOutputTokens })
  }
  if (model.modalityField !== undefined && !sameModalities(model.inputModalities, published.inputModalities)) {
    differences.push({ field: model.modalityField, configured: model.inputModalities, published: published.inputModalities })
  }
  const efforts = published.declaredEfforts
  if (efforts !== undefined && !sameEfforts(model.reasoningEfforts, efforts)) {
    differences.push({ field: 'reasoningEfforts', configured: model.reasoningEfforts, published: efforts })
  }
  return differences
}

/** Project one difference onto the JSON value a settings write carries. */
function writtenValue(difference: FieldDifference): JsonValue {
  if (typeof difference.published === 'number') return difference.published
  if (difference.published === false) return false
  if (difference.field === 'reasoningEfforts') return { ...(difference.published as Exclude<ReasoningEfforts, false | undefined>) }
  return [...difference.published as readonly ModelsDevModality[]]
}

/**
 * Build the edit that removes one model from a route.
 *
 * The settings document removes an array element by unsetting its index — the
 * one edit that both takes the entry out and shifts the ones behind it, which
 * is why the panel reads its rows again afterwards rather than trusting the
 * index it held when the reader pressed the button.
 *
 * @param route - the provider route whose namespace holds the models.
 * @param model - the configured model entry, whose index is its write address.
 * @returns one `unset` op addressing that index.
 */
export function removeModelOps(route: ConfiguredRoute, model: ConfiguredModel): SettingsPathOpView[] {
  return [{ op: 'unset', path: [...route.settingsPath, 'models', String(model.index)] }]
}

/**
 * Build the edits that adopt one model's catalog values.
 * @param route - the provider route whose namespace holds the model.
 * @param model - the configured model entry, whose index is its write address.
 * @param differences - the fields to adopt.
 * @returns one path-addressed set edit per difference.
 */
export function applyOps(
  route: ConfiguredRoute,
  model: ConfiguredModel,
  differences: readonly FieldDifference[],
): SettingsPathOpView[] {
  const base = [...route.settingsPath, 'models', String(model.index)]
  return differences.map(difference => ({ op: 'set', path: [...base, difference.field], value: writtenValue(difference) }))
}
