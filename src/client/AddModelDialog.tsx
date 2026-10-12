/**
 * The add-model dialog: the model id, the catalog entries that id reaches, and
 * the values one of them — or the route's own template — fills in. Everything
 * the dialog shows arrives through its props and everything it asks for leaves
 * through its callbacks, so it holds no Host access of its own.
 *
 * The fields are a preview, not a form the catalog dictates: an entry the
 * catalog published nothing for is still one a reader may want, so the confirm
 * button answers the route's own rules rather than the catalog's.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { newModelProblem, newModelTemplate, type NewModelEntry, type NewModelProblem } from './add-model.ts'
import { type ModelsDevLocaleKey } from './locales.ts'
import { CandidatePicker, ModelFields, fieldsFrom, optionKey, type PickerFields, type PickerTranslate } from './ModelPicker.tsx'
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
  route, picker, writable, busy, t, onSearch, onSubmit, onClose,
}: AddModelDialogProps): ReactNode {
  const [modelId, setModelId] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [fields, setFields] = useState<PickerFields>({ name: '', context: '', output: '', image: false })

  const template = useMemo(() => newModelTemplate(route.route), [route])
  // The chosen entry, or the only one the catalog answered with: a lone match is
  // the answer, not a choice the reader has to make.
  const active = picker.candidates.find(option => optionKey(option) === chosen)
    ?? (picker.candidates.length === 1 ? picker.candidates[0] : undefined)

  // The source the fields are filled from, and the source they were last filled
  // from. Re-running the fill only when that key changes is what keeps a manual
  // edit standing: the next read republishes the same candidates without it,
  // and picking the same entry again refills it directly.
  const sourceKey = active === undefined ? 'template' : optionKey(active)
  const filled = useRef<string | null>(null)
  useEffect(() => {
    if (filled.current === sourceKey) return
    filled.current = sourceKey
    setFields(active === undefined ? templateFields(template) : fieldsFrom(active))
  })

  const draft: NewModelEntry = {
    id: modelId,
    ...fields.name.trim() === '' ? {} : { name: fields.name },
    ...fields.context.trim() === '' ? {} : { contextWindow: Number(fields.context) },
    ...fields.output.trim() === '' ? {} : { maxTokens: Number(fields.output) },
    inputModalities: fields.image ? ['text', 'image'] : ['text'],
    ...template.modalityField === undefined ? {} : { modalityField: template.modalityField },
  }
  const problem = newModelProblem(route.route, draft)
  const named = modelId.trim() !== ''
  const disabled = !writable || busy

  const submit = (): void => {
    if (disabled || problem !== undefined) return
    onSubmit(draft)
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
        />
        <ModelFields fields={fields} disabled={disabled} t={t} onChange={setFields} />
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
  }
}