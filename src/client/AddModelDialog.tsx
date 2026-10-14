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
import { type ModelsDevLocaleKey } from './locales.ts'
import {
  CandidatePicker, ModelFields, bindingOf, effortFields, effortsFromFields, fieldsFrom, optionKey, upstreamFields,
  type PickerFields, type PickerTranslate, type UpstreamProbe,
} from './ModelPicker.tsx'
import type { EntryBinding } from './bindings.ts'
import type { ModelPickerState, RouteView } from './store.ts'
import css from './ModelsDevPage.module.css'

/** Everything the dialog needs from the panel around it. */
export interface AddModelDialogProps {
  /** Route the model is being added to. */
  readonly route: RouteView
  /** What the dialog is waiting on. */
  readonly picker: ModelPickerState
  /** The deployment accepts settings writes at all. */
  readonly writable: boolean
  /** That route's namespace has a write in flight. */
  readonly busy: boolean
  /** The panel's dictionary seat. */
  readonly t: PickerTranslate
  /** Search the catalog for one model id. */
  readonly onSearch: (modelId: string, fuzzy: boolean) => void
  /** Ask the route's own endpoint which models it serves. */
  readonly onDiscover: () => void
  /** Append the entry to the route, following the catalog entry it was filled from. */
  readonly onSubmit: (entry: NewModelEntry, binding: EntryBinding | undefined) => void
  /** Close without writing. */
  readonly onClose: () => void
}

/** Which dictionary key names each reason a draft cannot be written. */
const PROBLEM_KEYS = {
  'empty-id': 'addProblemEmptyId',
  'duplicate-id': 'addProblemDuplicate',
  'invalid-context': 'addProblemContext',
  'invalid-output': 'addProblemOutput',
  'invalid-efforts': 'addProblemEfforts',
} satisfies Record<NewModelProblem, ModelsDevLocaleKey>

/**
 * Render the add-model dialog.
 *
 * Mounted only while a dialog is open, so the id, the chosen entry, and the
 * edited values all start empty. The fields follow the chosen entry until the
 * reader changes them: a manual edit is kept until a different entry is picked,
 * so an id that briefly matched two candidates does not erase what was typed.
 *
 * @param props - the route, the pending search, and the panel's callbacks.
 * @returns the dialog element.
 */
export function AddModelDialog({
  route, picker, writable, busy, t, onSearch, onDiscover, onSubmit, onClose,
}: AddModelDialogProps): ReactNode {
  const [modelId, setModelId] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [upstream, setUpstream] = useState<LlmDiscoveredModel | null>(null)
  const [fields, setFields] = useState<PickerFields>(() => ({
    name: '', context: '', output: '', image: false, noReasoning: false,
    efforts: Object.fromEntries(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, ''])) as PickerFields['efforts'],
  }))

  const template = useMemo(() => newModelTemplate(route.route), [route])
  // The chosen entry, or the only one the catalog answered with: a lone match is
  // the answer, not a choice the reader has to make.
  const active = picker.candidates.find(option => optionKey(option) === chosen)
    ?? (picker.candidates.length === 1 ? picker.candidates[0] : undefined)

  // The source the fields are filled from, and the source they were last filled
  // from. Re-running the fill only when that key changes is what keeps a manual
  // edit standing: the next read republishes the same candidates without it,
  // and picking the same entry again refills it directly.
  //
  // The three sources are ranked, not merged: a catalog entry is what the model
  // will be compared against, so it wins over what the endpoint disclosed about
  // the id; the endpoint's answer wins over the route's own template.
  const source = active === undefined
    ? upstream === null
      ? { key: 'template', fields: templateFields(template) }
      : { key: `upstream:${upstream.id}`, fields: upstreamFields(upstream) }
    : { key: optionKey(active), fields: fieldsFrom(active) }
  const filled = useRef<string | null>(null)
  useEffect(() => {
    if (filled.current === source.key) return
    filled.current = source.key
    setFields(source.fields)
  })

  const efforts = route.route.reasoningCapable ? effortsFromFields(fields) : undefined
  const draft: NewModelEntry = {
    id: modelId,
    ...fields.name.trim() === '' ? {} : { name: fields.name },
    ...fields.context.trim() === '' ? {} : { contextWindow: Number(fields.context) },
    ...fields.output.trim() === '' ? {} : { maxTokens: Number(fields.output) },
    inputModalities: fields.image ? ['text', 'image'] : ['text'],
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
    ...template.modalityField === undefined ? {} : { modalityField: template.modalityField },
  }
  const problem = newModelProblem(route.route, draft)
  const named = modelId.trim() !== ''
  const disabled = !writable || busy
  // The ids the route already stores, so the endpoint's own listing can say
  // which of them is not a candidate for adding rather than offering one the
  // confirm button would refuse.
  const configured = useMemo(() => new Set(route.route.models.map(model => model.id)), [route])
  const probe: UpstreamProbe = {
    discovering: picker.discovering,
    models: picker.discovered,
    error: picker.discoverError,
    chosen: upstream === null ? null : upstream.id,
    configured,
    onFetch: onDiscover,
    onChoose: (model) => {
      // Taking a model asks the catalog the same question typing its id would,
      // so the entry comparison and the fuzzy fallback stay available for it,
      // and refills the preview from what the endpoint disclosed — exactly as
      // choosing a catalog entry refills it from that entry.
      setUpstream(model)
      setModelId(model.id)
      setFields(upstreamFields(model))
      onSearch(model.id, false)
    },
  }

  const submit = (): void => {
    if (disabled || problem !== undefined) return
    // The entry the fields were filled from is what the new model follows, the
    // same preference the editor files: an added gateway id has no comparison
    // otherwise, and the values just taken from that entry would be compared
    // against nothing. An id the catalog answered nothing for follows its id.
    onSubmit(draft, active === undefined ? undefined : bindingOf(active))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('addModelTitle')}
      closeLabel={t('addModelClose')}
      description={t('addModelDescription', { provider: route.route.displayName })}
      // The two class names are asserted rather than optional: a CSS-module key
      // is possibly undefined under this project's declarations, and a card that
      // silently fell back to the shared default would be the narrow one again.
      className={css.pickerDialog as string}
      contentClassName={css.pickerContent as string}
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
        <CandidatePicker
          picker={picker}
          active={active}
          disabled={disabled}
          t={t}
          modelId={modelId}
          onSearch={value => { setModelId(value); onSearch(value, false) }}
          onSearchSimilar={value => { onSearch(value, true) }}
          onChoose={(option) => { setChosen(optionKey(option)); setFields(fieldsFrom(option)) }}
          onConfirm={submit}
          upstream={probe}
        />
        <ModelFields
          fields={fields} disabled={disabled} t={t} onChange={setFields}
          reasoningCapable={route.route.reasoningCapable}
        />
        {!named || problem === undefined ? null : (
          <p className={css.diagnostic} role="alert">{t(PROBLEM_KEYS[problem])}</p>
        )}
      </div>
    </Modal>
  )
}

/** The template's values, shaped as the fields that hold them. */
function templateFields(template: ReturnType<typeof newModelTemplate>): PickerFields {
  return {
    name: '',
    context: template.contextWindow === undefined ? '' : String(template.contextWindow),
    output: template.maxTokens === undefined ? '' : String(template.maxTokens),
    image: template.inputModalities.includes('image'),
    ...effortFields(template.reasoningEfforts),
  }
}