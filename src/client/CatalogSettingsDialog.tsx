/**
 * The catalog settings dialog: the address the panel reads the catalog from.
 *
 * The browser performs the read itself, so a network that cannot reach the
 * published endpoint — a firewalled origin, a regional block — is one no
 * deployment configuration can fix. This dialog lets the reader point the
 * panel somewhere else: a mirror serving the same document at another origin,
 * or a CORS proxy whose address carries the target. Whatever is stored is the
 * address the fetch is pointed at, and the default is restored by clearing the
 * field.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './ModelFields.tsx'
import css from './ModelsDevPanel.module.css'

/** Everything the dialog needs from the panel around it. */
export interface CatalogSettingsDialogProps {
  /** Whether the dialog is showing. */
  readonly open: boolean
  /** The address the panel reads from right now. */
  readonly endpoint: string
  /** The address the panel reads from when no override is stored. */
  readonly defaultEndpoint: string
  /** The panel's dictionary seat. */
  readonly t: Translate
  /** Store the address and read again. */
  readonly onSave: (endpoint: string) => void
  /** Close without changing anything. */
  readonly onClose: () => void
}

/**
 * Render the catalog settings dialog.
 *
 * The field opens on the address in force, and the save button is disabled
 * while it holds the same value: a dialog that would "save" the present state
 * offers no decision. Clearing the field restores the default, which the
 * placeholder names so the reader can see what they are returning to.
 *
 * @param props - the open state, the current address, and the callbacks.
 * @returns the dialog element, or `null` when closed.
 */
export function CatalogSettingsDialog({
  open, endpoint, defaultEndpoint, t, onSave, onClose,
}: CatalogSettingsDialogProps): ReactNode {
  const [value, setValue] = useState(endpoint)
  // Re-open with the address in force, not the one the field held when the
  // dialog was last closed: a change made elsewhere — another tab, a reload —
  // is what the reader is shown.
  useEffect(() => { if (open) setValue(endpoint) }, [open, endpoint])
  const changed = value.trim() !== endpoint
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settingsTitle')}
      closeLabel={t('close')}
      description={t('settingsDescription')}
      className={css['dialog'] as string}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!changed} onClick={() => { onSave(value) }}>{t('settingsSave')}</Button>
        </>
      )}
    >
      <div className={css['addForm']}>
        <label className={css['specField']}>
          <span className={css['specLabel']}>{t('settingsEndpoint')}</span>
          <Input
            value={value}
            placeholder={t('settingsEndpointPlaceholder', { endpoint: defaultEndpoint })}
            data-modal-autofocus
            onChange={event => { setValue(event.target.value) }}
          />
        </label>
        <p className={css['hint']}>{t('settingsNote')}</p>
        {value.trim() === '' ? <p className={css['hint']}>{t('settingsReset', { endpoint: defaultEndpoint })}</p> : null}
      </div>
    </Modal>
  )
}
