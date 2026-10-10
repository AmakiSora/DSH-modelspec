/**
 * Comparing one configured model against its catalog entry, and turning the
 * differences into the path-addressed edits that adopt them. Only a value the
 * catalog publishes is ever written: an unpublished field leaves the
 * deployment's own configuration alone.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsDevMatch, ModelsDevModality } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ConfiguredModel, ConfiguredRoute, ModalityField } from './configured.ts'

/**
 * Stored field a difference is about. The two modality field names are both
 * included because a namespace names its own: whichever family declared the
 * entry is the field a write addresses.
 */
export type DifferenceField = 'contextWindow' | 'maxTokens' | ModalityField

/** One stored field whose value differs from the catalog entry. */
export interface FieldDifference {
  /** Stored field the difference is about. */
  readonly field: DifferenceField
  /** Value the deployment stores, or `undefined` when the entry declares none. */
  readonly configured: number | readonly ModelsDevModality[] | undefined
  /** Value the catalog publishes for it. */
  readonly published: number | readonly ModelsDevModality[]
}

/** Whether one difference is about the accepted modalities. */
export function isModalityDifference(difference: FieldDifference): boolean {
  return difference.field === 'input' || difference.field === 'inputModalities'
}

/** Compare two modality lists as sets, so order alone is not a difference. */
function sameModalities(left: readonly ModelsDevModality[], right: readonly ModelsDevModality[]): boolean {
  return left.length === right.length && left.every(entry => right.includes(entry))
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
  return differences
}

/** Project one difference onto the JSON value a settings write carries. */
function writtenValue(difference: FieldDifference): JsonValue {
  return typeof difference.published === 'number' ? difference.published : [...difference.published]
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
