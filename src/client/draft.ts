/**
 * One configured model as the panel's editor holds it, and the write that
 * commits it.
 *
 * The card is an editor in the shape of the harness's own Models settings: its
 * fields are staged values rather than the stored ones, and one Apply writes
 * whatever the staged values changed. That is why nothing here writes on a
 * keystroke — `draftOps` is handed the stored entry and the staged one and
 * emits only the edits between them, so repointing or re-reading a field that
 * ended up where it started costs no settings write at all.
 *
 * Two rules from the settings document survive the move into an editor:
 *
 * - a cleared field is an `unset`, which hands the field back to the adapter,
 *   because that is the only meaning "unset" has for a value the deployment may
 *   never have written itself;
 * - only a field the edit actually changed is addressed.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ConfiguredModel, ConfiguredRoute, ModalityField } from './configured.ts'
import type { ModelsDevModality, ModelsDevModel, ReasoningEfforts, ReasoningLevel } from './types.ts'
import { REASONING_LEVELS } from './types.ts'

/** Every input modality a model entry may declare, in the order the editor lists them. */
export const MODALITIES: readonly ModelsDevModality[] = ['text', 'image']

/** What a model row's `reasoningEfforts` field declares. */
export type ReasoningMode =
  /** The field is absent, so the adapter decides whether the model reasons. */
  | 'inherit'
  /** The entry declares `false`: the model does not reason at all. */
  | 'none'
  /** The entry declares a level → wire-value dict. */
  | 'levels'

/** One declared reasoning level and the wire value sent for it. */
export interface ReasoningLevelEntry {
  /** Level the harness UI offers. */
  readonly level: ReasoningLevel
  /** Wire value dispatch sends; empty for a level that sends no parameter. */
  readonly wire: string
}

/** The staged `reasoningEfforts` of one model. */
export interface ReasoningDraft {
  /** Which of the three declarations the entry makes. */
  readonly mode: ReasoningMode
  /** Declared levels, in the order the editor lists them; only read with `mode: 'levels'`. */
  readonly levels: readonly ReasoningLevelEntry[]
}

/** One configured model as the editor holds it, field by field. */
export interface ModelDraft {
  /**
   * The stored id this draft was opened from.
   *
   * It is the draft's identity guard: a reload that shifted the rows (a
   * removal in another window, say) would otherwise let a draft land on a
   * different model, so a draft whose base id no longer sits at its address is
   * discarded rather than applied.
   */
  readonly baseId: string
  /** Model id the provider accepts. */
  readonly id: string
  /** Display name, or an empty string to store none. */
  readonly name: string
  /** Combined context as typed; parsed when the draft is checked and written. */
  readonly contextWindow: string
  /** Output cap as typed. */
  readonly maxTokens: string
  /** Accepted modalities; never empty. */
  readonly inputModalities: readonly ModelsDevModality[]
  /** Declared reasoning efforts. */
  readonly reasoning: ReasoningDraft
}

/** Why one draft cannot be written into its route. */
export type DraftProblem =
  | 'empty-id'
  | 'duplicate-id'
  | 'invalid-context'
  | 'invalid-output'
  | 'invalid-efforts'

/** A capacity field's text read as a count. */
export type ParsedCapacity =
  /** The field is blank, which hands it back to the adapter. */
  | { readonly kind: 'unset' }
  /** The field holds a positive integer. */
  | { readonly kind: 'count'; readonly value: number }
  /** The field holds text neither adapter accepts. */
  | { readonly kind: 'invalid' }

/**
 * Read one capacity field's text.
 *
 * Both adapters accept a positive integer and nothing else, and the editor
 * writes the settings value itself rather than a display form: a field showing
 * `1.5M` would otherwise store a number the schema refuses.
 * @param text - the field's text as typed.
 * @returns the parsed count, or what stops it from being one.
 */
export function parseCapacity(text: string): ParsedCapacity {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'unset' }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' }
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value <= 0) return { kind: 'invalid' }
  return { kind: 'count', value }
}

/** The reasoning declaration a stored entry makes. */
export function reasoningDraft(efforts: ReasoningEfforts | undefined): ReasoningDraft {
  if (efforts === false) return { mode: 'none', levels: [] }
  if (efforts === undefined) return { mode: 'inherit', levels: [] }
  const levels: ReasoningLevelEntry[] = []
  for (const level of REASONING_LEVELS) {
    if (!(level in efforts)) continue
    const wire = efforts[level]
    levels.push({ level, wire: wire === null || wire === undefined ? '' : wire })
  }
  return { mode: 'levels', levels }
}

/**
 * Read one stored model into the editor's values.
 * @param model - the configured entry.
 * @returns the draft it opens as.
 */
export function draftOf(model: ConfiguredModel): ModelDraft {
  return {
    baseId: model.id,
    id: model.id,
    name: model.name ?? '',
    contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? '' : String(model.maxTokens),
    // Kept exactly as stored, empty included: an entry that declares no input
    // type inherits the route's own, and closing that gap on the editor's side
    // would make every such row open as an unsaved edit.
    inputModalities: [...model.inputModalities],
    reasoning: reasoningDraft(model.reasoningEfforts),
  }
}

/** The declaration a draft's reasoning block writes, or `undefined` for none. */
export function effortsOf(reasoning: ReasoningDraft): ReasoningEfforts | undefined {
  if (reasoning.mode === 'inherit') return undefined
  if (reasoning.mode === 'none') return false
  const dict: { [level in ReasoningLevel]?: string | null } = {}
  let declaresOff = false
  let off = ''
  for (const entry of reasoning.levels) {
    const wire = entry.wire.trim()
    if (entry.level === 'off') {
      declaresOff = true
      off = wire
      continue
    }
    if (wire !== '') dict[entry.level] = wire
  }
  if (!Object.keys(dict).some(level => level !== 'off')) {
    // Nothing beyond `off` is declared. A spelling the reader typed for `off`
    // is still handed over, so the draft rule refuses it with its reason; a
    // blank one declares nothing at all, which leaves the field to the adapter.
    return declaresOff && off !== '' ? { off } : undefined
  }
  // A declared `off` left blank is a level that is supported while the request
  // carries no parameter, so the key is written as `null`. An entry that never
  // declares `off` keeps it undeclared: that is the difference between "cannot
  // stop reasoning" and "stops by sending nothing", and the editor must not
  // invent it while a row sits untouched.
  if (declaresOff) dict.off = off === '' ? null : off
  return dict
}

/**
 * Compare two reasoning declarations level by level.
 *
 * A level is reported by its presence, not by its value alone: a dict naming
 * `off: null` says the level is supported while the request carries no
 * parameter, and a dict that omits `off` pins it unsupported. Those resolve to
 * different offerings, so they are a difference the panel must show — it is the
 * one an adopted catalog entry is most likely to correct.
 * @param left - one declaration.
 * @param right - the other.
 * @returns whether both declare the same levels with the same wire values.
 */
export function sameEfforts(left: ReasoningEfforts | undefined, right: ReasoningEfforts | undefined): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  if (left === false || right === false) return left === right
  for (const level of REASONING_LEVELS) {
    const declared = level in left
    if (declared !== (level in right)) return false
    if (declared && left[level] !== right[level]) return false
  }
  return true
}

/** Compare two modality lists as sets, so order alone is not a difference. */
export function sameModalities(left: readonly ModelsDevModality[], right: readonly ModelsDevModality[]): boolean {
  return left.length === right.length && left.every(entry => right.includes(entry))
}

/**
 * Whether a draft states anything different from the entry it was opened from.
 * @param draft - the staged values.
 * @param model - the stored entry.
 * @returns whether applying it would write.
 */
export function draftDiffers(draft: ModelDraft, model: ConfiguredModel): boolean {
  const context = parseCapacity(draft.contextWindow)
  const output = parseCapacity(draft.maxTokens)
  const sameCapacity = (parsed: ParsedCapacity, stored: number | undefined): boolean =>
    parsed.kind === 'unset' ? stored === undefined : parsed.kind === 'count' && parsed.value === stored
  return draft.id.trim() !== model.id
    || draft.name.trim() !== (model.name ?? '')
    || !sameCapacity(context, model.contextWindow)
    || !sameCapacity(output, model.maxTokens)
    || !sameModalities(draft.inputModalities, model.inputModalities)
    || !sameEfforts(effortsOf(draft.reasoning), model.reasoningEfforts)
}

/**
 * Read one catalog entry into a draft.
 *
 * Only what the entry publishes is adopted: a field it stays silent about keeps
 * the value the deployment already stores, because the panel never invents a
 * capacity the catalog does not declare.
 * @param draft - the values to fill.
 * @param entry - the published entry.
 * @returns the filled draft.
 */
export function adoptEntry(draft: ModelDraft, entry: ModelsDevModel): ModelDraft {
  return {
    ...draft,
    name: entry.name === '' ? draft.name : entry.name,
    ...entry.contextWindow === undefined ? {} : { contextWindow: String(entry.contextWindow) },
    ...entry.maxOutputTokens === undefined ? {} : { maxTokens: String(entry.maxOutputTokens) },
    ...entry.inputModalities.length === 0 ? {} : { inputModalities: [...entry.inputModalities] },
    reasoning: entry.declaredEfforts === undefined ? draft.reasoning : reasoningDraft(entry.declaredEfforts),
  }
}

/**
 * Adopt one published field into a draft, leaving every other field alone.
 * @param draft - the values to fill.
 * @param field - the stored field the value belongs to.
 * @param published - the value the catalog publishes for it.
 * @returns the filled draft.
 */
export function adoptField(
  draft: ModelDraft,
  field: 'contextWindow' | 'maxTokens' | ModalityField | 'reasoningEfforts',
  published: number | readonly ModelsDevModality[] | ReasoningEfforts,
): ModelDraft {
  if (field === 'contextWindow' && typeof published === 'number') {
    return { ...draft, contextWindow: String(published) }
  }
  if (field === 'maxTokens' && typeof published === 'number') {
    return { ...draft, maxTokens: String(published) }
  }
  if (field === 'reasoningEfforts') {
    return {
      ...draft,
      reasoning: reasoningDraft(published as ReasoningEfforts),
    }
  }
  return { ...draft, inputModalities: [...published as readonly ModelsDevModality[]] }
}

/**
 * Check one draft against what its route already holds.
 *
 * Each adapter refuses a duplicate model id inside one route, an empty id, a
 * capacity that is not a positive integer, and a reasoning dict that offers no
 * level beyond `off`, so each refusal is answered here rather than by a
 * namespace rejection the reader would only see after pressing Apply.
 * @param route - the route the model belongs to.
 * @param model - the entry at this draft's address.
 * @param draft - the staged values.
 * @returns the first problem that stops it, or `undefined` when it can be written.
 */
export function draftProblem(route: ConfiguredRoute, model: ConfiguredModel, draft: ModelDraft): DraftProblem | undefined {
  const id = draft.id.trim()
  if (id === '') return 'empty-id'
  if (route.models.some(other => other.index !== model.index && other.id === id)) return 'duplicate-id'
  if (parseCapacity(draft.contextWindow).kind === 'invalid') return 'invalid-context'
  if (parseCapacity(draft.maxTokens).kind === 'invalid') return 'invalid-output'
  // A staged reasoning declaration may not be empty while it says it declares
  // levels, but an empty modality list is legal: it inherits the route's own.
  // A staged switch that says "declares reasoning efforts" while declaring
  // nothing beyond `off` is a contradiction the adapter refuses, so it is
  // refused here rather than silently written as no declaration at all.
  if (draft.reasoning.mode === 'levels') {
    const efforts = effortsOf(draft.reasoning)
    if (efforts === undefined || efforts === false
      || !REASONING_LEVELS.some(level => level !== 'off' && (efforts[level] ?? '') !== '')) {
      return 'invalid-efforts'
    }
  }
  return undefined
}

/** The JSON value a reasoning declaration is written as. */
function effortsValue(efforts: ReasoningEfforts): JsonValue {
  return efforts === false ? false : { ...efforts }
}

/** The capacity a parsed field writes, or `undefined` for its `unset`. */
function capacityValue(parsed: ParsedCapacity): number | undefined {
  return parsed.kind === 'count' ? parsed.value : undefined
}

/**
 * Build the edits that put one draft into the namespace.
 *
 * The address is the model's index inside the route's `models` array, which is
 * the one thing a settings edit can address an existing element by. Fields the
 * draft left unchanged are not addressed at all, and a field it cleared is an
 * `unset` rather than an empty value.
 * @param route - the provider route whose namespace holds the model.
 * @param model - the configured entry, whose index is its write address.
 * @param draft - the staged values.
 * @returns one path-addressed edit per changed field.
 */
export function draftOps(route: ConfiguredRoute, model: ConfiguredModel, draft: ModelDraft): SettingsPathOpView[] {
  const base = [...route.settingsPath, 'models', String(model.index)]
  const ops: SettingsPathOpView[] = []
  const id = draft.id.trim()
  if (id !== model.id) ops.push({ op: 'set', path: [...base, 'id'], value: id })
  const name = draft.name.trim()
  if (name !== (model.name ?? '')) {
    ops.push(name === ''
      ? { op: 'unset', path: [...base, 'name'] }
      : { op: 'set', path: [...base, 'name'], value: name })
  }
  const capacities = [
    ['contextWindow', parseCapacity(draft.contextWindow), model.contextWindow],
    ['maxTokens', parseCapacity(draft.maxTokens), model.maxTokens],
  ] as const
  for (const [field, parsed, stored] of capacities) {
    const wanted = capacityValue(parsed)
    if (wanted === stored) continue
    ops.push(wanted === undefined
      ? { op: 'unset', path: [...base, field] }
      : { op: 'set', path: [...base, field], value: wanted })
  }
  if (model.modalityField !== undefined && !sameModalities(draft.inputModalities, model.inputModalities)) {
    ops.push({ op: 'set', path: [...base, model.modalityField], value: [...draft.inputModalities] })
  }
  const efforts = effortsOf(draft.reasoning)
  if (!sameEfforts(efforts, model.reasoningEfforts)) {
    ops.push(efforts === undefined
      ? { op: 'unset', path: [...base, 'reasoningEfforts'] }
      : { op: 'set', path: [...base, 'reasoningEfforts'], value: effortsValue(efforts) })
  }
  return ops
}
