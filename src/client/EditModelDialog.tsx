/**
 * The edit-model dialog: which catalog entry one configured model follows, and
 * the values it stores. Two changes live together because they are one decision
 * — repointing a model at another entry without taking that entry's values would
 * leave the row reporting a difference the reader just refused to adopt.
 *
 * The entry source is a panel preference rather than deployment configuration:
 * the settings document validates every write against the adapter's own schema,
 * which declares no field for it, so the binding is kept in this browser beside
 * the panel. It decides what the model is compared against and never what is
 * written.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { CandidatePicker, ModelFields, fieldsFrom, optionKey, type PickerFields, type PickerTranslate } from './ModelPicker.tsx'
import type { EntryBinding } from './bindings.ts'
import type { EditedModel } from './comparison.ts'
import type { ModelsDevOption } from './types.ts'
import type { ModelPickerState, ModelRowView, RouteView } from './store.ts'
import css from './ModelsDevPage.module.css'

/** Everything the dialog needs from the panel around it. */
export interface EditModelDialogProps {
  /** Route the model belongs to. */
  readonly route: RouteView
  /** The row being edited. */
  readonly row: ModelRowView
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
  /** Write the edit back, against the entry source it should follow. */
  readonly onSubmit: (edited: EditedModel, binding: EntryBinding | undefined) => void
  /** Close without writing. */
  readonly onClose: () => void
}

/** The entry a row currently follows, or `undefined` when it follows its id. */
function boundEntry(row: ModelRowView): EntryBinding | undefined {
  return row.match.strategy === 'bound' && row.match.model !== undefined
    ? { providerId: row.match.model.providerId, modelId: row.match.model.id }
    : undefined
}

/** The catalog entry one option names, in the shape a binding takes. */
function bindingOf(option: ModelsDevOption): EntryBinding {
  return { providerId: option.providerId, modelId: option.model.id }
}

/**
 * Render the edit-model dialog.
 *
 * The fields open on what the model already stores rather than on a sibling's
 * template: this model exists, and the question is what it should become rather
 * than what a new one should look like. Choosing another entry then fills the
 * fields with that entry's published values, exactly as it does when adding.
 *
 * @param props - the row, the pending search, and the panel's callbacks.
 * @returns the dialog element.
 */
export function EditModelDialog({
  route, row, picker, writable, busy, t, onSearch, onSubmit, onClose,
}: EditModelDialogProps): ReactNode {
  const pinned = boundEntry(row)
  const [modelId, setModelId] = useState(row.model.id)
  const [binding, setBinding] = useState<EntryBinding | undefined>(pinned)
  const [fields, setFields] = useState<PickerFields>(() => ({ ...fieldsFrom(undefined), ...modelFields(row) }))

  // The entry the fields are filled from: the one the reader pinned, or the one
  // the model already follows, or the single entry a search answered with.
  const current = useMemo(() => {
    const named = binding ?? (row.match.model === undefined ? undefined : {
      providerId: row.match.model.providerId,
      modelId: row.match.model.id,
    })
    if (named === undefined) return undefined
    const followed: ModelsDevOption | undefined = row.match.model === undefined ? undefined : {
      providerId: row.match.model.providerId,
      strategy: row.match.strategy,
      model: row.match.model,
    }
    return [...(followed === undefined ? [] : [followed]), ...picker.candidates]
      .find(option => option.model.id === named.modelId && option.providerId === named.providerId)
  }, [binding, row.match.model, row.match.strategy, picker.candidates])

  // One entry is the answer rather than a choice, exactly as when adding.
  const active = current ?? (picker.candidates.length === 1 ? picker.candidates[0] : undefined)

  const [lastSource, setLastSource] = useState<string | null>(null)
  useEffect(() => {
    const key = active === undefined ? 'none' : optionKey(active)
    if (lastSource === key) return
    setLastSource(key)
    setFields(active === undefined ? modelFields(row) : fieldsFrom(active))
  })

  const edited: EditedModel = {
    name: fields.name,
    ...fields.context.trim() === '' ? {} : { contextWindow: Number(fields.context) },
    ...fields.output.trim() === '' ? {} : { maxTokens: Number(fields.output) },
    inputModalities: fields.image ? ['text', 'image'] : ['text'],
  }
  const disabled = !writable || busy
  const submit = (): void => {
    if (disabled) return
    // Choosing nothing means the model follows its id again; choosing the entry
    // it already followed leaves it following that one.
    onSubmit(edited, binding ?? (pinned === undefined ? undefined : pinned))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editModelTitle')}
      closeLabel={t('addModelClose')}
      description={t('editModelDescription', { provider: route.route.displayName, model: row.model.id })}
      // Asserted for the same reason as the add dialog's: a CSS-module key is
      // possibly undefined, and the editor carries the same picker and fields.
      className={css.pickerDialog as string}
      contentClassName={css.pickerContent as string}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('addModelCancel')}</Button>
          <Button variant="primary" disabled={disabled} onClick={submit}>{t('editModelSave')}</Button>
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
          onChoose={(option) => { setBinding(bindingOf(option)); setFields(fieldsFrom(option)) }}
          onConfirm={submit}
        />
        <p className={css.meta}>
          {pinned === undefined
            ? t('editModelSourceAuto', { entry: row.match.model === undefined ? t('strategyNone') : row.match.model.id })
            : t('editModelSourcePinned', { entry: `${pinned.providerId}/${pinned.modelId}` })}
        </p>
        <ModelFields fields={fields} disabled={disabled} t={t} onChange={setFields} />
      </div>
    </Modal>
  )
}

/** The values one configured model already stores, shaped as the fields that hold them. */
function modelFields(row: ModelRowView): PickerFields {
  return {
    name: row.model.name ?? '',
    context: row.model.contextWindow === undefined ? '' : String(row.model.contextWindow),
    output: row.model.maxTokens === undefined ? '' : String(row.model.maxTokens),
    image: row.model.inputModalities.includes('image'),
  }
}