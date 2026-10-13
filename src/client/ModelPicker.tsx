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

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { STRATEGY_KEYS, type ModelsDevLocaleKey } from './locales.ts'
import type { ModelsDevOption, ModelsDevSimilarity, ReasoningEfforts, ReasoningLevel } from './types.ts'
import { REASONING_LEVELS } from './types.ts'
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
  /** Whether the entry declares a non-reasoning model outright. */
  readonly noReasoning: boolean
  /** The declared wire value per level; absent levels are empty strings. */
  readonly efforts: Readonly<Record<ReasoningLevel, string>>
}

/** The effort fields of an entry that declares nothing. */
const EMPTY_EFFORTS: Readonly<Record<ReasoningLevel, string>> = Object.fromEntries(
  REASONING_LEVELS.map(level => [level, '']),
) as Readonly<Record<ReasoningLevel, string>>

/** Read a stored or published dict into the flat effort fields. */
export function effortFields(efforts: ReasoningEfforts | undefined): Pick<PickerFields, 'noReasoning' | 'efforts'> {
  if (efforts === false) return { noReasoning: true, efforts: EMPTY_EFFORTS }
  if (efforts === undefined) return { noReasoning: false, efforts: EMPTY_EFFORTS }
  return {
    noReasoning: false,
    efforts: {
      ...EMPTY_EFFORTS,
      ...Object.fromEntries(
        Object.entries(efforts).map(([level, wire]) => [level, wire === null ? '' : wire]),
      ),
    } as Readonly<Record<ReasoningLevel, string>>,
  }
}

/** Read one published entry into the fields, or clear them when it published none. */
export function fieldsFrom(option: ModelsDevOption | undefined): PickerFields {
  const efforts = option?.model.declaredEfforts
  return {
    name: option?.model.name ?? '',
    context: option?.model.contextWindow === undefined ? '' : String(option.model.contextWindow),
    output: option?.model.maxOutputTokens === undefined ? '' : String(option.model.maxOutputTokens),
    image: option?.model.inputModalities.includes('image') ?? false,
    ...effortFields(efforts),
  }
}

/**
 * Read what one endpoint disclosed about a model into the fields.
 *
 * A listing endpoint commonly reports an id and nothing else, so a field it
 * stayed silent about is left empty rather than filled with a guess — the
 * adapter's own default applies there, exactly as it does for a draft typed by
 * hand. A name that only repeats the id is dropped for the same reason: it
 * says nothing the id does not, and storing it would look like a decision.
 *
 * @param model - one model the route's endpoint reported.
 * @returns the values the fields hold.
 */
export function upstreamFields(model: LlmDiscoveredModel): PickerFields {
  const named = model.name === undefined || model.name === model.id ? '' : model.name
  return {
    name: named,
    context: model.contextWindow === undefined ? '' : String(model.contextWindow),
    output: model.maxTokens === undefined ? '' : String(model.maxTokens),
    image: model.inputModalities?.includes('image') ?? false,
    noReasoning: false,
    efforts: EMPTY_EFFORTS,
  }
}

/** The upstream interrogation the add dialog offers beside the id field. */
export interface UpstreamProbe {
  /** Whether the route's endpoint is being asked. */
  readonly discovering: boolean
  /** What it answered, or `null` while it has not answered yet. */
  readonly models: readonly LlmDiscoveredModel[] | null
  /** Why it could not be asked, or `null`. */
  readonly error: string | null
  /** Id the reader took from that answer, or `null` while none is taken. */
  readonly chosen: string | null
  /** Ids the route already configures, which cannot be added again. */
  readonly configured: ReadonlySet<string>
  /** Ask the route's endpoint which models it serves. */
  readonly onFetch: () => void
  /** Take one reported model as the one being added. */
  readonly onChoose: (model: LlmDiscoveredModel) => void
}

/**
 * Whether one model an endpoint listed answers to a search query.
 *
 * The question is the substring one — case folded, anywhere in the id or the
 * name — because it is the reader narrowing a list they are looking at, not a
 * comparison this panel has to be careful about. A gateway publishes both a
 * route-style id (`vendor/model`) and a display name, and either is what
 * somebody remembers.
 *
 * @param model - one model the endpoint reported.
 * @param query - what the reader typed, untrimmed.
 * @returns whether the model belongs in the narrowed list.
 */
export function upstreamMatches(model: LlmDiscoveredModel, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return model.id.toLowerCase().includes(needle)
    || (model.name?.toLowerCase().includes(needle) ?? false)
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
  /** The route's own endpoint, when the dialog offers to ask it. */
  readonly upstream?: UpstreamProbe
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
  const { picker, active, disabled, t, modelId, onSearch, onSearchSimilar, onChoose, onConfirm, upstream } = props
  const fuzzy = picker.fuzzy
  // What the endpoint listed, and the query narrowing it. A provider that
  // serves a few dozen models is the ordinary case, so the listing is searched
  // rather than scrolled; a fresh answer drops the query, because the ids that
  // narrowed the last one would leave the new one looking empty.
  const listed = upstream?.models ?? null
  const [query, setQuery] = useState('')
  useEffect(() => { setQuery('') }, [listed])
  const matched = listed?.filter(model => upstreamMatches(model, query)) ?? []
  /** Whether the query is narrowing the listing at all. */
  const narrowing = query.trim() !== ''
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
      {/* The other way a reader who does not know the id can answer the same
          question: ask the route's own endpoint, on the Host, what it serves.
          It gets a row of its own because its label is a sentence and the id
          row already shares itself with one button. Offered only where a dialog
          asks for it — the editor chooses the entry of a model that already
          exists, not a model to create. */}
      {upstream === undefined ? null : (
        <div className={css.addUpstream}>
          <Button variant="outline" size="sm" disabled={disabled || upstream.discovering}
            onClick={upstream.onFetch}>
            {upstream.discovering ? t('addUpstreamFetching') : t('addUpstreamFetch')}
          </Button>
        </div>
      )}
      {upstream === undefined || upstream.error === null
        ? null
        : <p className={css.diagnostic} role="alert">{t('addUpstreamFailed', { message: upstream.error })}</p>}
      {upstream === undefined || listed === null ? null : listed.length === 0 ? (
        <p className={css.meta}>{t('addUpstreamEmpty')}</p>
      ) : (
        <>
          <div className={css.addUpstreamSearch}>
            <Input
              value={query}
              aria-label={t('addUpstreamSearch')}
              placeholder={t('addUpstreamSearch')}
              disabled={disabled}
              onChange={event => { setQuery(event.target.value) }}
            />
          </div>
          <p className={css.meta}>
            {narrowing
              ? matched.length === 0
                ? t('addUpstreamNoMatch', { query: query.trim() })
                : t('addUpstreamMatched', { count: String(matched.length) })
              : t('addUpstreamFound', { count: String(listed.length) })}
          </p>
          {matched.length === 0 ? null : (
            <ul className={css.candidates} role="radiogroup"
              aria-label={t('addUpstreamMatched', { count: String(matched.length) })}>
              {matched.map((model) => {
                const known = upstream.configured.has(model.id)
                return (
                  <li key={model.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={upstream.chosen === model.id}
                      className={css.candidate}
                      disabled={disabled || known}
                      onClick={() => { upstream.onChoose(model) }}
                    >
                      <span className={css.candidateName}>{model.name ?? model.id}</span>
                      <code className={css.candidateId}>{model.id}</code>
                      <span className={css.candidateMeta}>
                        {known
                          ? t('addUpstreamConfigured')
                          : t('addModelCandidateLimits', {
                            context: capacityText(model.contextWindow),
                            output: capacityText(model.maxTokens),
                          })}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
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
  /** Whether the route's family accepts a reasoning-efforts declaration. */
  readonly reasoningCapable: boolean
}

/** Read the flat effort fields back into the dict a model entry declares. */
export function effortsFromFields(fields: PickerFields): ReasoningEfforts | undefined {
  if (fields.noReasoning) return false
  const dict: { [level in ReasoningLevel]?: string | null } = {}
  for (const level of REASONING_LEVELS) {
    const wire = fields.efforts[level]
    if (wire === '') continue
    dict[level] = level === 'off' && wire.trim() === '' ? null : wire
  }
  return Object.keys(dict).length === 0 ? undefined : dict
}

/**
 * Render the fields one model entry stores.
 *
 * The effort block only appears where the route's namespace family declares the
 * field: on the Messages family a write carrying it would be refused by the
 * schema, so offering it would be an offer the confirm button cannot keep.
 *
 * @param props - the values, and the callback that replaces them.
 * @returns the block element.
 */
export function ModelFields({ fields, disabled, t, onChange, reasoningCapable }: ModelFieldProps): ReactNode {
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
      {!reasoningCapable ? null : (
        <fieldset className={css.efforts} disabled={disabled}>
          <legend className={css.addFieldName}>{t('fieldEfforts')}</legend>
          <Checkbox
            checked={fields.noReasoning}
            onChange={next => { change({ noReasoning: next }) }}
            label={t('effortsNonReasoning')}
            disabled={disabled}
            className={css.addImage}
          />
          {fields.noReasoning
            ? null
            : (
              <div className={css.effortGrid}>
                {REASONING_LEVELS.map(level => (
                  <label className={css.effortCell} key={level}>
                    <span className={css.effortLevel}>{t(`effort_${level}` as ModelsDevLocaleKey)}</span>
                    <Input
                      value={fields.efforts[level]}
                      placeholder={level === 'off' ? t('effortOffPlaceholder') : t('addModelUnset')}
                      disabled={disabled || fields.noReasoning}
                      onChange={event => { change({ efforts: { ...fields.efforts, [level]: event.target.value } }) }}
                    />
                  </label>
                ))}
              </div>
            )}
          <p className={css.meta}>{t('effortsNote')}</p>
        </fieldset>
      )}
    </>
  )
}