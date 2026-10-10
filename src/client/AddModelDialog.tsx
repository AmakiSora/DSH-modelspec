/**
 * The add-model dialog: the model id, the catalog entries that id reaches, and
 * the values one of them — or the route's own template — fills in. Everything
 * the dialog shows arrives through its props and everything it asks for leaves
 * through its callbacks, so it holds no Host access of its own.
 *
 * The fields are a preview, not a form the catalog dictates: an entry the
 * catalog published nothing for is still one a user may want, so the confirm
 * button answers the route's own rules rather than the catalog's.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, Checkbox, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { newModelProblem, newModelTemplate, type NewModelEntry, type NewModelProblem } from './add-model.ts'
import { STRATEGY_KEYS, type ModelsDevLocaleKey } from './locales.ts'
import type { ModelsDevOption, ModelsDevSimilarity } from './types.ts'
import type { AddModelState, RouteView } from './store.ts'
import css from './ModelsDevPage.module.css'

/** The dictionary seat the dialog renders from. */
export type AddModelTranslate = PropsLocale<'modelsDev'>['t']

/** Everything the dialog needs from the panel around it. */
export interface AddModelDialogProps {
  /** Route the model is being added to. */
  readonly route: RouteView
  /** What the dialog is waiting on. */
  readonly add: AddModelState
  /** The deployment accepts settings writes at all. */
  readonly writable: boolean
  /** That route's namespace has a write in flight. */
  readonly busy: boolean
  /** The panel's dictionary seat. */
  readonly t: AddModelTranslate
  /** Ask the catalog about one model id. */
  readonly onSearch: (modelId: string) => void
  /** Ask the catalog which ids came close to one model id. */
  readonly onSearchSimilar: (modelId: string) => void
  /** Append the entry to the route. */
  readonly onSubmit: (entry: NewModelEntry) => void
  /** Close without writing. */
  readonly onClose: () => void
}

/** Which dictionary key names each reason a draft cannot be written. */
const PROBLEM_KEYS = {
  'empty-id': 'addProblemEmptyId',
  'duplicate-id': 'addProblemDuplicate',
  'invalid-context': 'addProblemContext',
  'invalid-output': 'addProblemOutput',
} satisfies Record<NewModelProblem, ModelsDevLocaleKey>

/** Which dictionary key names each way a fuzzy search reached an entry. */
const SIMILARITY_KEYS = {
  folded: 'addSimilarFolded',
  contains: 'addSimilarContains',
  near: 'addSimilarNear',
} satisfies Record<ModelsDevSimilarity, ModelsDevLocaleKey>

/** One option's identity in the chooser: the provider it came from and its id. */
function candidateKey(candidate: ModelsDevOption): string {
  return `${candidate.providerId}/${candidate.model.id}`
}

/** One capacity rendered the way the chooser shows it; an unpublished one is a dash. */
function capacityText(value: number | undefined): string {
  return value === undefined ? '—' : String(value)
}

/** The capacities one option publishes, or the dashes for the ones it does not. */
function limitsText(candidate: ModelsDevOption, t: AddModelTranslate): string {
  return t('addModelCandidateLimits', {
    context: capacityText(candidate.model.contextWindow),
    output: capacityText(candidate.model.maxOutputTokens),
  })
}

/**
 * The line naming why one option was offered, or `null` when it needs none.
 *
 * An exact search already says which comparison found the entry, and a lone
 * answer speaks for itself. What needs saying is a fuzzy result, where the
 * reader has to judge a closeness the panel chose for them.
 *
 * @param candidate - the offered entry.
 * @param t - the dialog's dictionary seat.
 * @param only - whether this is the one entry the search answered with.
 * @returns the localized line, or `null`.
 */
function reasonText(candidate: ModelsDevOption, t: AddModelTranslate, only: boolean): string | null {
  if (!('similarity' in candidate)) {
    return only ? t('addModelMatched', { strategy: t(STRATEGY_KEYS[candidate.strategy]) }) : null
  }
  return t(SIMILARITY_KEYS[candidate.similarity], { count: String(candidate.distance ?? 0) })
}

/**
 * Render the add-model dialog.
 *
 * Mounted only while a dialog is open, so the id, the chosen entry, and the
 * edited values all start empty. The fields follow the chosen entry until the
 * user changes them: a manual edit is kept until a different entry is picked,
 * so an id that briefly matched two candidates does not erase what was typed.
 *
 * @param props - the route, the pending search, and the panel's three callbacks.
 * @returns the dialog element.
 */
export function AddModelDialog({
  route, add, writable, busy, t, onSearch, onSearchSimilar, onSubmit, onClose,
}: AddModelDialogProps): ReactNode {
  const [modelId, setModelId] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [context, setContext] = useState('')
  const [output, setOutput] = useState('')
  const [image, setImage] = useState(false)

  const template = useMemo(() => newModelTemplate(route.route), [route])
  // The chosen entry, or the only one the catalog answered with: a lone match is
  // the answer, not a choice the reader has to make.
  const active = add.candidates.find(candidate => candidateKey(candidate) === chosen)
    ?? (add.candidates.length === 1 ? add.candidates[0] : undefined)

  /**
   * Put one entry's published values, or the route's template, into the fields.
   * @param candidate - the entry to read, or `undefined` for the template.
   */
  const fill = (candidate: ModelsDevOption | undefined): void => {
    if (candidate === undefined) {
      setName('')
      setContext(template.contextWindow === undefined ? '' : String(template.contextWindow))
      setOutput(template.maxTokens === undefined ? '' : String(template.maxTokens))
      setImage(template.inputModalities.includes('image'))
      return
    }
    setName(candidate.model.name)
    setContext(candidate.model.contextWindow === undefined ? '' : String(candidate.model.contextWindow))
    setOutput(candidate.model.maxOutputTokens === undefined ? '' : String(candidate.model.maxOutputTokens))
    setImage(candidate.model.inputModalities.includes('image'))
  }

  // The source the fields are filled from, and the source they were last filled
  // from. Re-running the fill only when that key changes is what keeps a manual
  // edit standing: the next read republishes the same candidates without it,
  // and picking the same entry again refills it through `fill` directly.
  const sourceKey = active === undefined ? 'template' : candidateKey(active)
  const filled = useRef<string | null>(null)
  useEffect(() => {
    if (filled.current === sourceKey) return
    filled.current = sourceKey
    fill(active)
  })

  const draft: NewModelEntry = {
    id: modelId,
    ...name.trim() === '' ? {} : { name },
    ...context.trim() === '' ? {} : { contextWindow: Number(context) },
    ...output.trim() === '' ? {} : { maxTokens: Number(output) },
    inputModalities: image ? ['text', 'image'] : ['text'],
    ...template.modalityField === undefined ? {} : { modalityField: template.modalityField },
  }
  const problem = newModelProblem(route.route, draft)
  const named = modelId.trim() !== ''
  const disabled = !writable || busy

  const submit = (): void => {
    if (disabled || problem !== undefined) return
    onSubmit(draft)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('addModelTitle')}
      closeLabel={t('addModelClose')}
      description={t('addModelDescription', { provider: route.route.displayName })}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('addModelCancel')}</Button>
          <Button variant="primary" disabled={disabled || problem !== undefined} onClick={submit}>
            {t('addModelSubmit')}
          </Button>
        </>
      )}
    >
      <div className={css.addForm}>
        <div className={css.addIdRow}>
          <label className={css.addFieldName} htmlFor="model-aid-add-id">{t('addModelId')}</label>
          <Input
            id="model-aid-add-id"
            value={modelId}
            placeholder={t('addModelIdPlaceholder')}
            disabled={disabled}
            data-modal-autofocus
            onChange={event => {
              setModelId(event.target.value)
              onSearch(event.target.value)
            }}
            onKeyDown={onKeyDown}
          />
          {/* The comparisons need an exact relationship, so one wrong character
              leaves the reader nothing to pick from. This asks the looser
              question on demand rather than paying for it on every keystroke. */}
          <Button variant="outline" size="sm" disabled={disabled || modelId.trim() === ''}
            onClick={() => { onSearchSimilar(modelId) }}>
            {t('addModelFuzzy')}
          </Button>
        </div>
        {add.searching ? <p className={css.meta}>{t('addModelSearching')}</p> : null}
        {add.error === null ? null : <p className={css.diagnostic} role="alert">{t('addModelSearchFailed')}</p>}
        {add.candidates.length === 1 && active !== undefined && reasonText(active, t, true) !== null ? (
          <p className={css.meta}>{reasonText(active, t, true)}</p>
        ) : null}
        {add.candidates.length > 1 ? (
          <>
            <p className={css.meta}>
              {add.fuzzy
                ? t('addModelSimilar', { count: String(add.candidates.length) })
                : t('addModelCandidates', { count: String(add.candidates.length) })}
            </p>
            <ul className={css.candidates} role="radiogroup" aria-label={t('addModelCandidates', { count: String(add.candidates.length) })}>
              {add.candidates.map((candidate) => {
                const key = candidateKey(candidate)
                const reason = reasonText(candidate, t, false)
                return (
                  <li key={key}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active !== undefined && candidateKey(active) === key}
                      className={css.candidate}
                      disabled={disabled}
                      onClick={() => {
                        setChosen(key)
                        fill(candidate)
                      }}
                    >
                      <span className={css.candidateName}>{candidate.model.name}</span>
                      <code className={css.candidateId}>{candidate.model.id}</code>
                      <span className={css.candidateMeta}>{t('matchedProvider', { provider: candidate.providerId })}</span>
                      <span className={css.candidateMeta}>
                        {reason === null ? limitsText(candidate, t) : `${reason} · ${limitsText(candidate, t)}`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}
        {add.candidates.length === 0 && !add.searching ? (
          <p className={css.meta}>
            {add.error !== null
              ? t('addModelTemplateNote')
              : add.fuzzy ? t('addModelSimilarNone') : t('addModelNoMatch')}
          </p>
        ) : null}
        <label className={css.addField}>
          <span className={css.addFieldName}>{t('addModelName')}</span>
          <Input
            value={name}
            placeholder={t('addModelNamePlaceholder')}
            disabled={disabled}
            onChange={event => { setName(event.target.value) }}
          />
        </label>
        <label className={css.addField}>
          <span className={css.addFieldName}>{t('fieldContext')}</span>
          <Input
            value={context}
            inputMode="numeric"
            placeholder={t('addModelUnset')}
            disabled={disabled}
            onChange={event => { setContext(event.target.value) }}
          />
        </label>
        <label className={css.addField}>
          <span className={css.addFieldName}>{t('fieldMaxTokens')}</span>
          <Input
            value={output}
            inputMode="numeric"
            placeholder={t('addModelUnset')}
            disabled={disabled}
            onChange={event => { setOutput(event.target.value) }}
          />
        </label>
        <Checkbox
          checked={image}
          onChange={setImage}
          label={t('addModelImage')}
          disabled={disabled}
          className={css.addImage}
        />
        {!named || problem === undefined ? null : (
          <p className={css.diagnostic} role="alert">{t(PROBLEM_KEYS[problem])}</p>
        )}
      </div>
    </Modal>
  )
}