/**
 * The dialog that decides which catalog entry one configured model follows.
 *
 * The choice is a panel preference, not deployment configuration: the settings
 * document declares no field for it, so it is kept in this browser and decides
 * what the row is compared against — never what is written. Clearing it returns
 * the model to the automatic match, which is the state a row is in before
 * anybody pins anything.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Checkbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { CandidateList, entryLabel, optionKey } from './CandidateList.tsx'
import type { Translate } from './ModelFields.tsx'
import type { EntryBinding } from './bindings.ts'
import type { EditorState, ModelRowView, RouteView } from './store.ts'
import type { ModelsDevOption } from './types.ts'
import css from './ModelsDevPanel.module.css'

/** Everything the dialog needs from the panel around it. */
export interface EntryDialogProps {
  /** Route the model belongs to. */
  readonly route: RouteView
  /** The configured model being repointed. */
  readonly row: ModelRowView
  /** What the dialog is waiting on. */
  readonly editor: EditorState
  /** The deployment accepts writes at all. */
  readonly writable: boolean
  /** That route's namespace has a write in flight. */
  readonly busy: boolean
  /** The panel's dictionary seat. */
  readonly t: Translate
  /** Search the catalog for one model id; `fuzzy` asks for ids that came close. */
  readonly onSearch: (modelId: string, fuzzy: boolean) => void
  /** Pin the chosen entry (`undefined` returns to the automatic match) and optionally fill the card from it. */
  readonly onConfirm: (option: ModelsDevOption | undefined, adoptValues: boolean) => void
  /** Close without changing anything. */
  readonly onClose: () => void
}

/**
 * Render the catalog-entry dialog.
 *
 * It asks the catalog about the model's own id as it opens, so the row's current
 * comparison is on screen rather than one keystroke away.
 *
 * @param props - the route, the model, the pending search, and the callbacks.
 * @returns the dialog element.
 */
export function EntryDialog({
  route, row, editor, writable, busy, t, onSearch, onConfirm, onClose,
}: EntryDialogProps): ReactNode {
  const disabled = !writable || busy
  const pinned = row.match.strategy === 'bound'
  // The current entry, preselected when it is one the search will offer.
  const [chosen, setChosen] = useState<string | undefined>(() => {
    const entry = row.match.model
    return pinned && entry !== undefined ? `${row.match.providerKey ?? ''}/${entry.id}` : undefined
  })
  const [adoptValues, setAdoptValues] = useState(true)
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (editor.modelId.trim() !== '') onSearch(editor.modelId, false)
  })
  const active = editor.candidates.find(option => optionKey(option) === chosen)
    // A lone answer is the answer, exactly as it is in the add dialog: offering
    // a list of one to scroll past would ask a question with one possible reply.
    ?? (editor.candidates.length === 1 ? editor.candidates[0] : undefined)
  const binding: EntryBinding | undefined = active === undefined
    ? undefined
    : { providerId: active.providerId, modelId: active.model.id }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('entryTitle')}
      closeLabel={t('close')}
      description={t('entryDescription', { model: row.model.id, provider: route.route.displayName })}
      className={css['dialog'] as string}
      contentClassName={css['dialogContent'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={disabled} onClick={() => { onConfirm(active, adoptValues) }}>
            {t('entrySubmit')}
          </Button>
        </>
      )}
    >
      <div className={css['addForm']}>
        {active === undefined
          ? <p className={css['hint']}>{t('entryAutoHint')}</p>
          : null}
        <CandidateList
          editor={editor}
          active={active}
          disabled={disabled}
          t={t}
          onSearch={onSearch}
          onChoose={(option) => { setChosen(optionKey(option)) }}
          onConfirm={() => { onConfirm(active, adoptValues) }}
        />
        <Checkbox
          label={t('entryAdopt')}
          checked={adoptValues}
          disabled={disabled}
          onChange={setAdoptValues}
        />
        <div className={css['dialogActions']}>
          <button
            type="button"
            className={css['secondaryButton']}
            disabled={disabled}
            onClick={() => { onConfirm(undefined, adoptValues) }}
          >
            {t('entryAuto')}
          </button>
          {binding === undefined
            ? null
            : <span className={css['hint']}>{entryLabel(binding.providerId, binding.modelId)}</span>}
        </div>
      </div>
    </Modal>
  )
}
