/**
 * The three specification fields one model row and the add-model dialog share:
 * the two capacities, the accepted input types, and the reasoning-efforts
 * declaration.
 *
 * They are shared because they are shared, not merely alike — both surfaces
 * edit the same fields of the same entry, so one definition is what keeps the
 * dialog and the row from offering different rules for the same value. Each
 * field also carries the catalog's published value beside it, because that is
 * what this panel exists to show; the adopt action writes into the staged
 * values and never into the namespace.
 */

import type { ReactNode } from 'react'
import {
  Checkbox, IconPlusOutlineRegular, IconTrashOutlineRegular, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsDevModality, ReasoningEfforts, ReasoningLevel } from './types.ts'
import { REASONING_LEVELS } from './types.ts'
import { MODALITIES, type ReasoningDraft } from './draft.ts'
import css from './ModelsDevPanel.module.css'

/** The panel's dictionary seat. */
export type Translate = PropsLocale<'modelsDev'>['t']

/** The line under a field that names what the catalog publishes for it. */
interface PublishedHintProps {
  /** Localized description of the published value. */
  readonly text: string
  /** Adopt label, or `undefined` when the value is already the staged one. */
  readonly onAdopt?: (() => void) | undefined
  /** Whether every control refuses changes. */
  readonly disabled: boolean
  /** Panel copy. */
  readonly t: Translate
}

/** Render the catalog line beside a field, with the adopt action when it differs. */
function PublishedHint({ text, onAdopt, disabled, t }: PublishedHintProps): ReactNode {
  return (
    <span className={css['hint']}>
      {text}
      {onAdopt === undefined
        ? null
        : (
          <button type="button" className={css['hintAction']} disabled={disabled} onClick={onAdopt}>
            {t('adopt')}
          </button>
        )}
    </span>
  )
}

/** Props of {@link CapacityField}. */
export interface CapacityFieldProps {
  /** Localized field name. */
  readonly label: string
  /** The staged text. */
  readonly value: string
  /** Placeholder shown while the field is empty. */
  readonly placeholder?: string | undefined
  /** Published capacity, or `undefined` when the catalog publishes none. */
  readonly published?: number | undefined
  /** Whether the staged text already counts to the published value. */
  readonly adopted?: boolean
  /** Fill the field from the published value. */
  readonly onAdopt?: (() => void) | undefined
  /** Replace the staged text. */
  readonly onChange: (text: string) => void
  /** Whether every control refuses changes. */
  readonly disabled: boolean
  /** Panel copy. */
  readonly t: Translate
}

/**
 * Render one token-count field with the catalog's answer beside it.
 * @param props - the staged text, the published count, and the adopt action.
 * @returns the labeled field.
 */
export function CapacityField(props: CapacityFieldProps): ReactNode {
  const { label, value, placeholder, published, adopted, onAdopt, onChange, disabled, t } = props
  const text = published === undefined
    ? t('publishedUnset')
    : t('publishedLabel', { value: String(published) })
  return (
    <label className={css['specField']}>
      <span className={css['specLabel']}>{label}</span>
      <input
        className={css['input']}
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder ?? t('valueUnset')}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => { onChange(event.target.value) }}
      />
      <PublishedHint
        text={text}
        onAdopt={published !== undefined && adopted !== true ? onAdopt : undefined}
        disabled={disabled}
        t={t}
      />
    </label>
  )
}

/** Props of {@link ModalitiesField}. */
export interface ModalitiesFieldProps {
  /** The staged modalities; never empty. */
  readonly value: readonly ModelsDevModality[]
  /** Published modalities, or `undefined` when the catalog publishes none. */
  readonly published?: readonly ModelsDevModality[] | undefined
  /** Fill the field from the published list. */
  readonly onAdopt?: (() => void) | undefined
  /** Replace the staged list. */
  readonly onChange: (modalities: readonly ModelsDevModality[]) => void
  /** Whether every control refuses changes. */
  readonly disabled: boolean
  /** Panel copy. */
  readonly t: Translate
}

/**
 * Render the accepted input types as mutually independent checkboxes, keeping
 * at least one chosen so the entry never declares a model that accepts nothing.
 * @param props - the staged list and the published one.
 * @returns the labeled field set.
 */
export function ModalitiesField(props: ModalitiesFieldProps): ReactNode {
  const { value, published, onAdopt, onChange, disabled, t } = props
  // An entry that declares nothing inherits the route's own list, which the
  // checkboxes show as text without staging a change the reader never made.
  const selected = value.length === 0 ? ['text'] as const : value
  const differs = published !== undefined
    && (published.length !== value.length || !published.every(entry => value.includes(entry)))
  return (
    <fieldset className={css['specField']}>
      <legend className={css['specLabel']}>{t('fieldInput')}</legend>
      <div className={css['modalityChoices']}>
        {MODALITIES.map(modality => (
          <Checkbox
            key={modality}
            label={t(modality === 'text' ? 'modalityText' : 'modalityImage')}
            checked={selected.includes(modality)}
            // The last chosen type stays checked: an entry declaring nothing
            // falls back to the adapter's own default, which is not what the
            // reader asked for by clearing every box.
            disabled={disabled || (selected.length === 1 && selected.includes(modality))}
            onChange={(checked) => {
              const next = MODALITIES.filter(candidate =>
                candidate === modality ? checked : selected.includes(candidate))
              if (next.length > 0) onChange(next)
            }}
          />
        ))}
      </div>
      <PublishedHint
        text={published === undefined
          ? t('publishedUnset')
          : t('publishedLabel', { value: modalitiesText(published, t) })}
        onAdopt={differs ? onAdopt : undefined}
        disabled={disabled}
        t={t}
      />
    </fieldset>
  )
}

/**
 * Spell a modality list the way the panel shows it.
 * @param modalities - the list to spell.
 * @param t - panel copy.
 * @returns the localized list, joined with ` + `.
 */
export function modalitiesText(modalities: readonly ModelsDevModality[], t: Translate): string {
  return modalities.map(modality => t(modality === 'image' ? 'modalityImage' : 'modalityText')).join(' + ')
}

/** The levels a fresh declaration starts from. */
const INITIAL_LEVELS: readonly ReasoningLevel[] = ['off', 'low', 'high']

/** The wire value a level sends unless its row says otherwise. */
function defaultWire(level: ReasoningLevel): string {
  return level === 'off' ? '' : level
}

/** The declaration a switch turned on writes when the catalog named one. */
function initialLevels(published: ReasoningEfforts | undefined): ReasoningDraft['levels'] {
  if (published === undefined || published === false) {
    return INITIAL_LEVELS.map(level => ({ level, wire: defaultWire(level) }))
  }
  const declared = REASONING_LEVELS.filter(level => level in published)
  const chosen = declared.length > 0 ? declared : INITIAL_LEVELS
  return chosen.map(level => ({
    level,
    wire: level !== 'off' && typeof published[level] === 'string' ? published[level] : defaultWire(level),
  }))
}

/** Props of {@link ReasoningField}. */
export interface ReasoningFieldProps {
  /** The staged declaration. */
  readonly value: ReasoningDraft
  /** Published declaration, or `undefined` when the catalog publishes none. */
  readonly published?: ReasoningEfforts | undefined
  /** Fill the field from the published declaration. */
  readonly onAdopt?: (() => void) | undefined
  /** Replace the staged declaration. */
  readonly onChange: (reasoning: ReasoningDraft) => void
  /** Whether every control refuses changes. */
  readonly disabled: boolean
  /** One-based row position, for accessible names. */
  readonly position?: number | undefined
  /** Panel copy. */
  readonly t: Translate
}

/**
 * Render the reasoning-strength declaration: a switch between "nothing
 * declared" and a level list, the list itself, and the outright
 * non-reasoning declaration the adapter also accepts.
 * @param props - the staged declaration and the published one.
 * @returns the labeled group.
 */
export function ReasoningField(props: ReasoningFieldProps): ReactNode {
  const { value, published, onAdopt, onChange, disabled, position, t } = props
  const usedLevels = value.levels.map(entry => entry.level)
  const freeLevel = REASONING_LEVELS.find(level => !usedLevels.includes(level))
  const label = position === undefined ? t('fieldEfforts') : `${t('fieldEfforts')} ${String(position)}`
  const publishedText = published === undefined
    ? t('publishedUnset')
    : published === false
      ? t('effortsFalse')
      : Object.entries(published)
        .sort(([left], [right]) => REASONING_LEVELS.indexOf(left as ReasoningLevel) - REASONING_LEVELS.indexOf(right as ReasoningLevel))
        .map(([level, wire]) => (wire === null ? `${level}=∅` : `${level}=${String(wire)}`))
        .join(' · ')
  const written = value.mode === 'levels'
    ? value.levels
      .map(entry => (entry.wire.trim() === '' ? `${entry.level}=∅` : `${entry.level}=${entry.wire.trim()}`))
      .join(' · ')
    : ''
  const adopted = published === undefined
    ? false
    : published === false
      ? value.mode === 'none'
      : publishedText === written && value.mode === 'levels'
  return (
    <div className={css['reasoning']} role="group" aria-label={label}>
      <div className={css['reasoningHead']}>
        <span className={css['specLabel']}>{t('fieldEfforts')}</span>
        <Switch
          checked={value.mode === 'levels'}
          label={t('effortsDeclare')}
          disabled={disabled}
          onChange={(on) => {
            onChange(on
              ? { mode: 'levels', levels: initialLevels(published) }
              : { mode: 'inherit', levels: [] })
          }}
        />
      </div>
      {value.mode === 'levels'
        ? (
          <>
            {value.levels.length === 0
              ? null
              : (
                <div className={css['reasoningRow']} aria-hidden="true">
                  <span className={css['specLabel']}>{t('effortLevel')}</span>
                  <span className={css['specLabel']}>{t('effortWire')}</span>
                </div>
              )}
            {value.levels.map((entry, index) => (
              <div key={index} className={css['reasoningRow']}>
                <select
                  className={`${css['input']} ${css['selectInput']}`}
                  value={entry.level}
                  aria-label={`${t('effortLevel')} ${String(index + 1)}`}
                  disabled={disabled}
                  onChange={(event) => {
                    const level = event.target.value as ReasoningLevel
                    // A custom spelling survives a move between two thinking
                    // levels; crossing to or from `off` resets it, because `off`
                    // is the level that sends no parameter.
                    const carried = entry.wire !== '' && entry.wire !== entry.level
                      && entry.level !== 'off' && level !== 'off'
                    onChange({
                      ...value,
                      levels: value.levels.map((existing, at) => at === index
                        ? { level, wire: carried ? entry.wire : defaultWire(level) }
                        : existing),
                    })
                  }}
                >
                  {REASONING_LEVELS.filter(choice => choice === entry.level || !usedLevels.includes(choice))
                    .map(choice => <option key={choice} value={choice}>{choice}</option>)}
                </select>
                <input
                  className={`${css['input']} ${css['reasoningValue']}`}
                  type="text"
                  value={entry.wire}
                  placeholder={entry.level === 'off' ? t('effortOffPlaceholder') : entry.level}
                  aria-label={`${entry.level} ${t('effortWire')}`}
                  disabled={disabled || entry.level === 'off'}
                  onChange={(event) => {
                    onChange({
                      ...value,
                      levels: value.levels.map((existing, at) => at === index
                        ? { level: entry.level, wire: event.target.value }
                        : existing),
                    })
                  }}
                />
                <button
                  type="button"
                  className={`${css['iconButton']} ${css['iconButtonDanger']}`}
                  aria-label={`${t('effortRemove')} ${entry.level}`}
                  title={t('effortRemove')}
                  disabled={disabled}
                  onClick={() => {
                    onChange({ ...value, levels: value.levels.filter((_level, at) => at !== index) })
                  }}
                >
                  <IconTrashOutlineRegular size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${css['addModelButton']} ${css['addLevelButton']}`}
              disabled={disabled || freeLevel === undefined}
              onClick={() => {
                if (freeLevel === undefined) return
                onChange({
                  ...value,
                  levels: [...value.levels, { level: freeLevel, wire: defaultWire(freeLevel) }],
                })
              }}
            >
              <IconPlusOutlineRegular size={14} />
              {t('effortAdd')}
            </button>
          </>
        )
        : null}
      <Checkbox
        className={css['reasoningNone']}
        label={t('effortsNonReasoning')}
        checked={value.mode === 'none'}
        disabled={disabled}
        onChange={(checked) => {
          onChange(checked ? { mode: 'none', levels: [] } : { mode: 'inherit', levels: [] })
        }}
      />
      <PublishedHint
        text={t('publishedLabel', { value: publishedText })}
        onAdopt={published !== undefined && !adopted ? onAdopt : undefined}
        disabled={disabled}
        t={t}
      />
    </div>
  )
}
