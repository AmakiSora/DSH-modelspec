/**
 * The confirmation one model removal asks for.
 *
 * Removing a model takes it out of the deployment's configuration, which is not
 * something a mis-click can undo from here: putting it back means adding it
 * again, and if it was the route's only model the route stops appearing on the
 * panel altogether. The dialog therefore names the model, says what happens to
 * the route, and waits for an explicit answer.
 *
 * It is deliberately not the shared risk acknowledgement, which gates an action
 * behind a checkbox: this is one reversible-by-adding edit against a value the
 * reader can see, not a permission.
 */

import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './ModelFields.tsx'
import type { RouteView } from './store.ts'
import css from './ModelsDevPanel.module.css'

/** Everything the confirmation needs from the page around it. */
export interface RemoveModelDialogProps {
  /** Route the model belongs to. */
  readonly route: RouteView
  /** The model about to be removed. */
  readonly modelId: string
  /** Whether the model is the last one this route stores. */
  readonly last: boolean
  /** That route's namespace has a write in flight. */
  readonly busy: boolean
  /** The panel's dictionary seat. */
  readonly t: Translate
  /** Remove it. */
  readonly onConfirm: () => void
  /** Close without removing. */
  readonly onClose: () => void
}

/**
 * Render the remove-model confirmation.
 * @param props - the route, the model, and the two answers.
 * @returns the dialog element.
 */
export function RemoveModelDialog({
  route, modelId, last, busy, t, onConfirm, onClose,
}: RemoveModelDialogProps): ReactNode {
  return (
    <Modal
      open
      onClose={onClose}
      title={t('removeTitle')}
      closeLabel={t('close')}
      description={t('removeDescription', { model: modelId, provider: route.route.displayName })}
      className={css['dialog'] as string}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? t('removing') : t('removeConfirm')}
          </Button>
        </>
      )}
    >
      <ul className={css['confirmList']}>
        <li>{t('removeKeeps', { model: modelId })}</li>
        <li>{last ? t('removeLast') : t('removeShifts')}</li>
      </ul>
    </Modal>
  )
}
