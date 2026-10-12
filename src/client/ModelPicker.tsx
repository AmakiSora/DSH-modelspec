/**
 * The two halves of the model picker both dialogs share: the block that finds a
 * catalog entry for a model id, and the fields an entry fills in.
 *
 * They are shared because they are shared, not merely alike — adding a model and
 * editing one ask the catalog the same question and write the same four fields,
 * and the only thing that differs is where the values come from and which
 * namespace the result lands in. Keeping one copy means the two dialogs cannot
 * drift into offering different rules for the same choice.
 */

import { type KeyboardEvent, type ReactNode } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { STRATEGY_KEYS, type ModelsDevLocaleKey } from './locales.ts'
import type { ModelsDevOption, ModelsDevSimilarity } from './types.ts'
import type { ModelPickerState } from './store.ts'
import css from './ModelsDevPage.module.css'

/** The dictionary seat the picker renders from. */
export type PickerTranslate = PropsLocale<'modelsDev'>['t']

/** Which dictionary key names each way a fuzzy search reached an entry. */
const SIMILARITY_KEYS = {
  folded: 'addSimilarFolded',
  contains: 'addSimilarContains',
  near: 'addSimilarNear',
} satisfies Record<ModelsDevSimilarity, ModelsDevLocaleKey>

/** One option's identity in the chooser: the provider it came from and its id. */
export function optionKey(option: ModelsDevOption): string {
  return `${option.providerId}/${option.model.id}`
}

/** One capacity rendered the way the chooser shows it; an unpublished one is a dash. */
export function capacityText(value: number | undefined): string {
  return value === undefined ? '—' : String(value)
}

/**
 * The line naming why one option was offered, or `null` when it needs none.
 *
 * An exact search already says which comparison found the entry, and a lone
 * answer speaks for itself. What needs saying is a fuzzy result, where the
 * reader has to judge a closeness the panel chose for them.
 *
 * @param option - the offered entry.
 * @param t - the picker's dictionary seat.
 * @param only - whether this is the one entry the search answered with.
 * @returns the localized line, or `null`.
 */
export function reasonText(option: ModelsDevOption, t: PickerTranslate, only: boolean): string | null {
  if (!('similarity' in option)) {
    return only ? t('addModelMatched', { strategy: t(STRATEGY_KEYS[option.strategy]) }) : null
  }
  return t(SIMILARITY_KEYS[option.similarity], { count: String(option.distance ?? 0) })
}

/** The values the picker fields hold. */
export interface PickerFields {
  /** Display name, or empty to store none. */
  readonly name: string
  /** Combined context, or empty to leave the field to the adapter. */
  readonly context: string
  /** Output cap, or empty to leave the field to the adapter. */
  readonly output: string
  /** Whether the model accepts image input; text is always accepted. */
  readonly image: boolean
}

/** Read one published entry into the fields, or clear them when it published none. */
export function fieldsFrom(option: ModelsDevOption | undefined): PickerFields {
  return {
    name: option?.model.name ?? '',
    context: option?.model.contextWindow === undefined ? '' : String(option.model.contextWindow),
    output: option?.model.maxOutputTokens === undefined ? '' : String(option.model.maxOutputTokens),
    image: option?.model.inputModalities.includes('image') ?? false,
  }
}

/** Everything the candidate chooser needs from the dialog around it. */
export interface CandidatePickerProps {
  /** The pending search, as the controller published it. */
  readonly picker: ModelPickerState
  /** The option the fields are filled from. */
  readonly active: ModelsDevOption | undefined
  /** Every control in the block refuses changes. */
  readonly disabled: boolean
  /** The picker's dictionary seat. */
  readonly t: PickerTranslate
  /** The id currently in the field. */
  readonly modelId: string
  /** Search the catalog for that id. */
  readonly onSearch: (modelId: string) => void
  /** Search the catalog for the ids that came close to it. */
  readonly onSearchSimilar: (modelId: string) => void
  /** Choose one entry. */
  readonly onChoose: (option: ModelsDevOption) => void
  /** Confirm from the id field; Enter submits rather than inserting a break. */
  readonly onConfirm: () => void
}

/**
 * Render the model id field, the search controls, and the chooser.
 *
 * The id field is shared because both dialogs need it: adding asks which model
 * to create, editing asks which entry the model already there should follow.
 *
 * @param props - the pending search, the chosen entry, and the callbacks.
 * @returns the block element.
 */
export function CandidatePicker(props: CandidatePickerProps): ReactNode {
  const { picker, active, disabled, t, modelId, onSearch, onSearchSimilar, onChoose, onConfirm } = props
  const fuzzy = picker.fuzzy
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onConfirm()
  }
  return (
    <>
      <div className={css.addIdRow}>
        <label className={css.addFieldName} htmlFor="dsh-modelspec-add-id">{t('addModelId')}</label>
        <Input
          id="dsh-modelspec-add-id"
          value={modelId}
          placeholder={t('addModelIdPlaceholder')}
          disabled={disabled}
          data-modal-autofocus
          onChange={event => { onSearch(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        {/* The comparisons need an exact relationship, so one wrong character
            leaves the reader nothing to pick from. This asks the looser question
            on demand rather than paying for it on every keystroke. */}
        <Button variant="outline" size="sm" disabled={disabled || modelId.trim() === ''}
          onClick={() => { onSearchSimilar(modelId) }}>
          {t('addModelFuzzy')}
        </Button>
      </div>
      {picker.searching ? <p className={css.meta}>{t('addModelSearching')}</p> : null}
      {picker.error === null ? null : <p className={css.diagnostic} role="alert">{t('addModelSearchFailed')}</p>}
      {picker.candidates.length === 1 && active !== undefined && reasonText(active, t, true) !== null ? (
        <p className={css.meta}>{reasonText(active, t, true)}</p>
      ) : null}
      {picker.candidates.length > 1 ? (
        <>
          <p className={css.meta}>
            {fuzzy
              ? t('addModelSimilar', { count: String(picker.candidates.length) })
              : t('addModelCandidates', { count: String(picker.candidates.length) })}
          </p>
          <ul className={css.candidates} role="radiogroup" aria-label={t('addModelCandidates', { count: String(picker.candidates.length) })}>
            {picker.candidates.map((option) => {
              const key = optionKey(option)
              const reason = reasonText(option, t, false)
              const limits = t('addModelCandidateLimits', {
                context: capacityText(option.model.contextWindow),
                output: capacityText(option.model.maxOutputTokens),
              })
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active !== undefined && optionKey(active) === key}
                    className={css.candidate}
                    disabled={disabled}
                    onClick={() => { onChoose(option) }}
                  >
                    <span className={css.candidateName}>{option.model.name}</span>
                    <code className={css.candidateId}>{option.model.id}</code>
                    <span className={css.candidateMeta}>{t('matchedProvider', { provider: option.providerId })}</span>
                    <span className={css.candidateMeta}>
                      {reason === null ? limits : `${reason} · ${limits}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {picker.candidates.length === 0 && !picker.searching ? (
        <p className={css.meta}>
          {picker.error !== null
            ? t('addModelTemplateNote')
            : fuzzy ? t('addModelSimilarNone') : t('addModelNoMatch')}
        </p>
      ) : null}
    </>
  )
}

/** Everything the field block needs from the dialog around it. */
export interface ModelFieldProps {
  /** The values the fields hold. */
  readonly fields: PickerFields
  /** Every control in the block refuses changes. */
  readonly disabled: boolean
  /** The picker's dictionary seat. */
  readonly t: PickerTranslate
  /** Replace the values. */
  readonly onChange: (fields: PickerFields) => void
}

/**
 * Render the four fields one model entry stores.
 *
 * @param props - the values, and the callback that replaces them.
 * @returns the block element.
 */
export function ModelFields({ fields, disabled, t, onChange }: ModelFieldProps): ReactNode {
  const change = (next: Partial<PickerFields>): void => { onChange({ ...fields, ...next }) }
  return (
    <>
      <label className={css.addField}>
        <span className={css.addFieldName}>{t('addModelName')}</span>
        <Input
          value={fields.name}
          placeholder={t('addModelNamePlaceholder')}
          disabled={disabled}
          onChange={event => { change({ name: event.target.value }) }}
        />
      </label>
      <label className={css.addField}>
        <span className={css.addFieldName}>{t('fieldContext')}</span>
        <Input
          value={fields.context}
          inputMode="numeric"
          placeholder={t('addModelUnset')}
          disabled={disabled}
          onChange={event => { change({ context: event.target.value }) }}
        />
      </label>
      <label className={css.addField}>
        <span className={css.addFieldName}>{t('fieldMaxTokens')}</span>
        <Input
          value={fields.output}
          inputMode="numeric"
          placeholder={t('addModelUnset')}
          disabled={disabled}
          onChange={event => { change({ output: event.target.value }) }}
        />
      </label>
      <Checkbox
        checked={fields.image}
        onChange={next => { change({ image: next }) }}
        label={t('addModelImage')}
        disabled={disabled}
        className={css.addImage}
      />
    </>
  )
}