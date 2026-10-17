/**
 * The block both dialogs share: the model id being asked about, the catalog
 * entries that id reaches, and — for the add dialog — the ids the route's own
 * endpoint says it serves.
 *
 * They are shared because they are shared, not merely alike: adding a model and
 * repointing one ask the catalog the same question, and the only thing that
 * differs is what happens to the answer. Keeping one copy means the two dialogs
 * cannot drift into offering different answers to the same id.
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { EditorState } from './store.ts'
import type { ModelsDevOption, ModelsDevSimilarity } from './types.ts'
import { STRATEGY_KEYS } from './locales.ts'
import type { Translate } from './ModelFields.tsx'
import css from './ModelsDevPanel.module.css'

/** Which dictionary key names each way a fuzzy search reached an entry. */
const SIMILARITY_KEYS = {
  folded: 'addSimilarFolded',
  contains: 'addSimilarContains',
  near: 'addSimilarNear',
} satisfies Record<ModelsDevSimilarity, Parameters<Translate>[0]>

/** One option's identity in the chooser: the provider it came from and its id. */
export function optionKey(option: ModelsDevOption): string {
  return `${option.providerId}/${option.model.id}`
}

/**
 * Name one catalog entry for a reader.
 *
 * Providers that publish route-style ids (`deepseek/deepseek-v4-flash`) already
 * carry their own vendor prefix, so prefixing the provider key again would name
 * a model nobody can find; only an id that does not start with it gets one.
 * @param providerKey - the catalog provider that publishes the entry.
 * @param id - the entry's own id.
 * @returns the readable entry identity.
 */
export function entryLabel(providerKey: string | undefined, id: string): string {
  if (providerKey === undefined) return id
  return id.startsWith(`${providerKey}/`) ? id : `${providerKey}/${id}`
}

/** One capacity rendered the way the chooser shows it; an unpublished one is a dash. */
function capacityText(value: number | undefined): string {
  return value === undefined ? '—' : String(value)
}

/**
 * The line naming why one option was offered, or `undefined` when it needs none.
 *
 * An exact search already says which comparison found the entry, and a lone
 * answer speaks for itself. What needs saying is a fuzzy result, where the
 * reader has to judge a closeness the panel chose for them.
 *
 * @param option - the offered entry.
 * @param t - the dialog's dictionary seat.
 * @param only - whether this is the one entry the search answered with.
 * @returns the localized line, or `undefined`.
 */
export function reasonText(option: ModelsDevOption, t: Translate, only: boolean): string | undefined {
  if (!('similarity' in option)) {
    return only ? t('addModelMatched', { strategy: t(STRATEGY_KEYS[option.strategy]) }) : undefined
  }
  return t(SIMILARITY_KEYS[option.similarity], { count: String(option.distance ?? 0) })
}

/** What the route's own endpoint answered, when the dialog offers to ask it. */
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

/** Props of {@link CandidateList}. */
export interface CandidateListProps {
  /** The pending search, as the controller published it. */
  readonly editor: EditorState
  /** The option the fields are filled from. */
  readonly active: ModelsDevOption | undefined
  /** Whether every control refuses changes. */
  readonly disabled: boolean
  /** The route's own endpoint, when the dialog offers to ask it. */
  readonly upstream?: UpstreamProbe | undefined
  /** Ask the catalog about one id; `fuzzy` asks for ids that merely came close. */
  readonly onSearch: (modelId: string, fuzzy: boolean) => void
  /** Choose one entry. */
  readonly onChoose: (option: ModelsDevOption) => void
  /** Confirm from the id field; Enter submits rather than inserting a break. */
  readonly onConfirm: () => void
  /** Dialog copy. */
  readonly t: Translate
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

/**
 * Render the id field, the search controls, and both choosers.
 * @param props - the pending search, the chosen entry, and the callbacks.
 * @returns the block element.
 */
export function CandidateList(props: CandidateListProps): ReactNode {
  const { editor, active, disabled, upstream, onSearch, onChoose, onConfirm, t } = props
  // What the endpoint listed, and the query narrowing it. A provider that
  // serves a few dozen models is the ordinary case, so the listing is searched
  // rather than scrolled. The query is dropped by the press that starts a fresh
  // interrogation, because the ids that narrowed the last answer would leave
  // the new one looking empty.
  const listed = upstream?.models ?? null
  const [query, setQuery] = useState('')
  const matched = listed?.filter(model => upstreamMatches(model, query)) ?? []
  const narrowing = query.trim() !== ''
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onConfirm()
  }
  return (
    <>
      <div className={css['idRow']}>
        <label className={css['specLabel']} htmlFor="dsh-modelspec-model-id">{t('addModelId')}</label>
        <Input
          id="dsh-modelspec-model-id"
          value={editor.modelId}
          placeholder={t('addModelIdPlaceholder')}
          disabled={disabled}
          data-modal-autofocus
          onChange={event => { onSearch(event.target.value, false) }}
          onKeyDown={onKeyDown}
        />
        {/* The comparisons need an exact relationship, so one wrong character
            leaves the reader nothing to pick from. This asks the looser question
            on demand rather than paying for it on every keystroke. */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || editor.modelId.trim() === ''}
          onClick={() => { onSearch(editor.modelId, true) }}
        >
          {t('addModelFuzzy')}
        </Button>
      </div>
      {upstream === undefined
        ? null
        : (
          <>
            {/* The other way a reader who does not know the id can answer the
                same question: ask the route's own endpoint, on the Host, what it
                serves. */}
            <div className={css['upstreamRow']}>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || upstream.discovering}
                onClick={() => { setQuery(''); upstream.onFetch() }}
              >
                {upstream.discovering ? t('addUpstreamFetching') : t('addUpstreamFetch')}
              </Button>
            </div>
            {upstream.error === null
              ? null
              : <p className={css['error']} role="alert">{t('addUpstreamFailed', { message: upstream.error })}</p>}
            {listed === null ? null : listed.length === 0 ? (
              <p className={css['hint']}>{t('addUpstreamEmpty')}</p>
            ) : (
              <>
                <Input
                  value={query}
                  aria-label={t('addUpstreamSearch')}
                  placeholder={t('addUpstreamSearch')}
                  disabled={disabled}
                  onChange={event => { setQuery(event.target.value) }}
                />
                <p className={css['hint']}>
                  {narrowing
                    ? matched.length === 0
                      ? t('addUpstreamNoMatch', { query: query.trim() })
                      : t('addUpstreamMatched', { count: String(matched.length) })
                    : t('addUpstreamFound', { count: String(listed.length) })}
                </p>
                {matched.length === 0 ? null : (
                  <ul className={css['candidates']} role="radiogroup"
                    aria-label={t('addUpstreamMatched', { count: String(matched.length) })}>
                    {matched.map((model) => {
                      const known = upstream.configured.has(model.id)
                      return (
                        <li key={model.id}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={upstream.chosen === model.id}
                            className={css['candidate']}
                            disabled={disabled || known}
                            onClick={() => { upstream.onChoose(model) }}
                          >
                            <span className={css['candidateName']}>{model.name ?? model.id}</span>
                            <code className={css['candidateId']}>{model.id}</code>
                            <span className={css['candidateMeta']}>
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
          </>
        )}
      {editor.searching ? <p className={css['hint']}>{t('addModelSearching')}</p> : null}
      {editor.error === null ? null : <p className={css['error']} role="alert">{t('addModelSearchFailed')}</p>}
      {editor.candidates.length === 1 && active !== undefined && reasonText(active, t, true) !== undefined
        ? <p className={css['hint']}>{reasonText(active, t, true)}</p>
        : null}
      {editor.candidates.length > 1
        ? (
          <>
            <p className={css['hint']}>
              {editor.fuzzy
                ? t('addModelSimilar', { count: String(editor.candidates.length) })
                : t('addModelCandidates', { count: String(editor.candidates.length) })}
            </p>
            <ul
              className={css['candidates']}
              role="radiogroup"
              aria-label={t('addModelCandidates', { count: String(editor.candidates.length) })}
            >
              {editor.candidates.map((option) => {
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
                      className={css['candidate']}
                      disabled={disabled}
                      onClick={() => { onChoose(option) }}
                    >
                      <span className={css['candidateName']}>{option.model.name}</span>
                      <code className={css['candidateId']}>{option.model.id}</code>
                      <span className={css['candidateMeta']}>{option.providerId}</span>
                      <span className={css['candidateMeta']}>{reason === undefined ? limits : `${reason} · ${limits}`}</span>
                      {option.model.status === 'deprecated'
                        ? <Tag tone="warning">{t('deprecatedTag')}</Tag>
                        : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )
        : null}
      {editor.candidates.length === 0 && !editor.searching && editor.modelId.trim() !== ''
        ? (
          <p className={css['hint']}>
            {editor.error !== null
              ? t('addModelTemplateNote')
              : editor.fuzzy ? t('addModelSimilarNone') : t('addModelNoMatch')}
          </p>
        )
        : null}
    </>
  )
}
