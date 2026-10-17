/**
 * The add-model dialog: the model id, the catalog entries that id reaches, and
 * the values one of them — or the route's own template — fills in. Everything
 * the dialog shows arrives through its props and everything it asks for leaves
 * through its callbacks, so it holds no Host access of its own.
 *
 * The fields are a preview, not a form the catalog dictates: an entry the
 * catalog published nothing for is still one a reader may want, so the confirm
 * button answers the route's own rules rather than the catalog's.
 *
 * Two questions reach the same id. The catalog answers "what does models.dev
 * publish for the id I typed", and the route's own endpoint answers "which ids
 * exist at all" — the second is what a reader who has never seen this provider's
 * listing needs. The two answers fill the same fields, and the catalog's wins
 * when it has one, because that entry is what the row will be compared against.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { newModelProblem, newModelTemplate, type NewModelEntry, type NewModelProblem } from './add-model.ts'
import { PROBLEM_KEYS } from './locales.ts'
import type { ModelsDevModel, ModelsDevOption } from './types.ts'
import { CandidateList, optionKey, type UpstreamProbe } from './CandidateList.tsx'
import {
  CapacityField, ModalitiesField, ReasoningField, type Translate,
} from './ModelFields.tsx'
import {
  MODALITIES, effortsOf, parseCapacity, reasoningDraft, type ModelDraft,
} from './draft.ts'
import type { EntryBinding } from './bindings.ts'
import type { EditorState, RouteView } from './store.ts'
import css from './ModelsDevPanel.module.css'

/** Everything the dialog needs from the panel around it. */
export interface AddModelDialogProps {
  /** Route the model is being added to. */
  readonly route: RouteView
  /** What the dialog is waiting on. */
  readonly editor: EditorState
  /** The deployment accepts settings writes at all. */
  readonly writable: boolean
  /** That route's namespace has a write in flight. */
  readonly busy: boolean
  /** The panel's dictionary seat. */
  readonly t: Translate
  /** Search the catalog for one model id; `fuzzy` asks for ids that came close. */
  readonly onSearch: (modelId: string, fuzzy: boolean) => void
  /** Ask the route's own endpoint which models it serves. */
  readonly onDiscover: () => void
  /** Append the entry to the route, following the catalog entry it was filled from. */
  readonly onSubmit: (entry: NewModelEntry, binding: EntryBinding | undefined) => void
  /** Close without writing. */
  readonly onClose: () => void
}

/** The entries the dialog's fields can be filled from, ranked. */
type Fill = { readonly key: string; readonly fields: ModelDraft }

/** The field values one published entry fills. */
function fieldsFromEntry(entry: ModelsDevModel): ModelDraft {
  return {
    baseId: '',
    id: '',
    name: entry.name,
    contextWindow: entry.contextWindow === undefined ? '' : String(entry.contextWindow),
    maxTokens: entry.maxOutputTokens === undefined ? '' : String(entry.maxOutputTokens),
    inputModalities: entry.inputModalities.length === 0 ? [...MODALITIES] : [...entry.inputModalities],
    reasoning: reasoningDraft(entry.declaredEfforts),
  }
}

/** The field values one endpoint listing fills. */
function fieldsFromUpstream(model: LlmDiscoveredModel): ModelDraft {
  return {
    baseId: '',
    id: '',
    // A name that only repeats the id says nothing the id does not, and storing
    // it would look like a decision the reader did not make.
    name: model.name === undefined || model.name === model.id ? '' : model.name,
    contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? '' : String(model.maxTokens),
    inputModalities: model.inputModalities?.length ? [...model.inputModalities] : [...MODALITIES].slice(0, 1),
    reasoning: { mode: 'inherit', levels: [] },
  }
}

/** The field values the route's own template fills. */
function fieldsFromTemplate(template: ReturnType<typeof newModelTemplate>): ModelDraft {
  return {
    baseId: '',
    id: '',
    name: '',
    contextWindow: template.contextWindow === undefined ? '' : String(template.contextWindow),
    maxTokens: template.maxTokens === undefined ? '' : String(template.maxTokens),
    inputModalities: template.inputModalities.length === 0 ? ['text'] : [...template.inputModalities],
    reasoning: reasoningDraft(template.reasoningEfforts),
  }
}

/**
 * Render the add-model dialog.
 *
 * Mounted only while it is open, so the chosen entry and the edited values all
 * start empty. The fields follow the chosen entry until the reader changes them:
 * a manual edit is kept while the same source stays active, and choosing a
 * different entry refills them.
 *
 * @param props - the route, the pending search, and the panel's callbacks.
 * @returns the dialog element.
 */
export function AddModelDialog({
  route, editor, writable, busy, t, onSearch, onDiscover, onSubmit, onClose,
}: AddModelDialogProps): ReactNode {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [upstream, setUpstream] = useState<LlmDiscoveredModel | null>(null)
  const [draft, setDraft] = useState<ModelDraft>(() => fieldsFromTemplate(newModelTemplate(route.route)))
  const template = useMemo(() => newModelTemplate(route.route), [route.route])
  const disabled = !writable || busy

  // The chosen entry, or the only one the catalog answered with: a lone match is
  // the answer, not a choice the reader has to make.
  const active: ModelsDevOption | undefined = editor.candidates.find(option => optionKey(option) === chosen)
    ?? (editor.candidates.length === 1 ? editor.candidates[0] : undefined)

  // The three sources are ranked, not merged: a catalog entry is what the model
  // will be compared against, so it wins over what the endpoint disclosed about
  // the id; the endpoint's answer wins over the route's own template.
  const source: Fill = active !== undefined
    ? { key: optionKey(active), fields: fieldsFromEntry(active.model) }
    : upstream !== null
      ? { key: `upstream:${upstream.id}`, fields: fieldsFromUpstream(upstream) }
      : { key: 'template', fields: fieldsFromTemplate(template) }
  const filled = useRef<string | null>(null)
  useEffect(() => {
    if (filled.current === source.key) return
    filled.current = source.key
    setDraft(source.fields)
  })

  const context = parseCapacity(draft.contextWindow)
  const output = parseCapacity(draft.maxTokens)
  const efforts = route.route.reasoningCapable ? effortsOf(draft.reasoning) : undefined
  const entry: NewModelEntry = {
    id: editor.modelId,
    ...draft.name.trim() === '' ? {} : { name: draft.name },
    ...context.kind === 'count' ? { contextWindow: context.value } : {},
    ...output.kind === 'count' ? { maxTokens: output.value } : {},
    inputModalities: draft.inputModalities,
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
    ...template.modalityField === undefined ? {} : { modalityField: template.modalityField },
  }
  const problem: NewModelProblem | undefined = newModelProblem(route.route, entry)
  const named = editor.modelId.trim() !== ''
  const configured = useMemo(() => new Set(route.route.models.map(model => model.id)), [route.route.models])
  const probe: UpstreamProbe = {
    discovering: editor.discovering,
    models: editor.discovered,
    error: editor.discoverError,
    chosen: upstream === null ? null : upstream.id,
    configured,
    onFetch: onDiscover,
    onChoose: (model) => {
      // Taking a model asks the catalog the same question typing its id would,
      // so the entry comparison and the fuzzy fallback stay available for it,
      // and refills the preview from what the endpoint disclosed — exactly as
      // choosing a catalog entry refills it from that entry.
      setUpstream(model)
      setDraft(fieldsFromUpstream(model))
      onSearch(model.id, false)
    },
  }

  const submit = (): void => {
    if (disabled || problem !== undefined) return
    // The entry the fields were filled from is what the new model follows: an
    // added gateway id has no comparison otherwise, and the values just taken
    // from that entry would be compared against nothing. An id the catalog
    // answered nothing for follows its id.
    onSubmit(entry, active === undefined ? undefined : { providerId: active.providerId, modelId: active.model.id })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('addModelTitle')}
      closeLabel={t('close')}
      description={t('addModelDescription', { provider: route.route.displayName })}
      className={css['dialog'] as string}
      contentClassName={css['dialogContent'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={disabled || problem !== undefined} onClick={submit}>
            {t('addSubmit')}
          </Button>
        </>
      )}
    >
      <div className={css['addForm']}>
        <CandidateList
          editor={editor}
          active={active}
          disabled={disabled}
          t={t}
          upstream={probe}
          onSearch={onSearch}
          onChoose={(option) => { setChosen(optionKey(option)); setDraft(fieldsFromEntry(option.model)) }}
          onConfirm={submit}
        />
        <div className={css['specGrid']}>
          <label className={css['specField']}>
            <span className={css['specLabel']}>{t('addModelName')}</span>
            <input
              className={css['input']}
              type="text"
              value={draft.name}
              placeholder={t('addModelNamePlaceholder')}
              disabled={disabled}
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
            />
          </label>
          <CapacityField
            label={t('fieldContext')}
            value={draft.contextWindow}
            published={active?.model.contextWindow}
            adopted={context.kind === 'count' && context.value === active?.model.contextWindow}
            disabled={disabled}
            t={t}
            onChange={(text) => { setDraft({ ...draft, contextWindow: text }) }}
            {...active === undefined ? {} : {
              onAdopt: () => {
                if (active.model.contextWindow !== undefined) {
                  setDraft({ ...draft, contextWindow: String(active.model.contextWindow) })
                }
              },
            }}
          />
          <CapacityField
            label={t('fieldMaxTokens')}
            value={draft.maxTokens}
            published={active?.model.maxOutputTokens}
            adopted={output.kind === 'count' && output.value === active?.model.maxOutputTokens}
            disabled={disabled}
            t={t}
            onChange={(text) => { setDraft({ ...draft, maxTokens: text }) }}
            {...active === undefined ? {} : {
              onAdopt: () => {
                if (active.model.maxOutputTokens !== undefined) {
                  setDraft({ ...draft, maxTokens: String(active.model.maxOutputTokens) })
                }
              },
            }}
          />
          {template.modalityField === undefined
            ? null
            : (
              <ModalitiesField
                value={draft.inputModalities}
                published={active?.model.inputModalities}
                disabled={disabled}
                t={t}
                onChange={(modalities) => { setDraft({ ...draft, inputModalities: modalities }) }}
                {...active === undefined ? {} : {
                  onAdopt: () => {
                    if (active.model.inputModalities.length > 0) {
                      setDraft({ ...draft, inputModalities: [...active.model.inputModalities] })
                    }
                  },
                }}
              />
            )}
          {route.route.reasoningCapable
            ? (
              <ReasoningField
                value={draft.reasoning}
                published={active?.model.declaredEfforts}
                disabled={disabled}
                t={t}
                onChange={(reasoning) => { setDraft({ ...draft, reasoning }) }}
                {...active?.model.declaredEfforts === undefined ? {} : {
                  onAdopt: () => { setDraft({ ...draft, reasoning: reasoningDraft(active?.model.declaredEfforts) }) },
                }}
              />
            )
            : null}
        </div>
        {!named || problem === undefined
          ? null
          : <p className={css['error']} role="alert">{t(PROBLEM_KEYS[problem])}</p>}
      </div>
    </Modal>
  )
}
