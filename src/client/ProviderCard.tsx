/**
 * One configured provider route, drawn as a card in the shape the harness's own
 * Models settings uses: a head that names the route and carries its actions, and
 * an editing body that holds the model list.
 *
 * The card owns only the fold. Its staged values live above it, because the
 * panel's bulk adopt must know whether any card holds unsaved edits before it
 * writes, and two surfaces disagreeing about what is unsaved is exactly the
 * state this panel must not be able to reach.
 */

import { useId, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconPlusOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelDraft } from './draft.ts'
import type { ModelRowView, RouteView } from './store.ts'
import { ModelRow } from './ModelRow.tsx'
import type { Translate } from './ModelFields.tsx'
import css from './ModelsDevPanel.module.css'

/** Props of {@link ProviderCard}. */
export interface ProviderCardProps {
  /** The configured route and every model it stores. */
  readonly route: RouteView
  /** The staged values of one model, which the panel resolves for every row. */
  readonly draftOf: (row: ModelRowView) => ModelDraft
  /** Whether any model of this route holds an unsaved edit. */
  readonly dirty: boolean
  /** Whether a write for this route's namespace is in flight. */
  readonly busy: boolean
  /** Whether the profile accepts settings writes at all. */
  readonly writable: boolean
  /** Whether the catalog answered this read. */
  readonly catalogAvailable: boolean
  /** Replace one model's staged values. */
  readonly onDraft: (modelKey: string, draft: ModelDraft) => void
  /** Fill every model's staged values from the catalog. */
  readonly onAdopt: () => void
  /** Discard this route's staged values. */
  readonly onCancel: () => void
  /** Commit this route's staged values. */
  readonly onApply: () => void
  /** Open the add-model dialog for this route. */
  readonly onAdd: () => void
  /** Open the dialog that picks which entry one model follows. */
  readonly onOpenEntry: (modelKey: string) => void
  /** Ask for confirmation before removing one model. */
  readonly onRemove: (modelKey: string) => void
  /** Panel copy. */
  readonly t: Translate
}

/**
 * Render one provider route.
 *
 * The fold is local state, as in the harness's own Models page: a reader folds
 * the cards they are not working in, and the panel republishes every card on
 * each read.
 * @param props - the route, its staged values, and the panel's callbacks.
 * @returns the provider card.
 */
export function ProviderCard(props: ProviderCardProps): ReactNode {
  const {
    route, draftOf, dirty, busy, writable, catalogAvailable,
    onDraft, onAdopt, onCancel, onApply, onAdd, onOpenEntry, onRemove, t,
  } = props
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  const config = route.route
  const preset = config.preset
  const differing = route.models.filter(row => row.differences.length > 0)
  const editable = writable && !preset && !busy
  const resolved = route.models.some(row => row.match.routeProviderKey !== undefined) || preset
  const status = !catalogAvailable
    ? { tone: 'neutral' as const, text: t('routeNoCatalog') }
    : differing.length === 0
      ? { tone: 'success' as const, text: t('routeMatching') }
      : { tone: 'warning' as const, text: t('routeDiffering', { count: String(differing.length) }) }
  return (
    <li className={css['providerCard']}>
      <div className={css['providerHead']}>
        <button
          type="button"
          className={css['providerToggle']}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => { setOpen(value => !value) }}
        >
          {open
            ? <IconChevronDownOutlineRegular size={14} aria-hidden="true" />
            : <IconChevronRightOutlineRegular size={14} aria-hidden="true" />}
          <span className={css['providerName']}>{config.displayName}</span>
          <code className={css['providerRoute']}>{config.provider}</code>
          <Tag tone={preset ? 'neutral' : 'info'}>{preset ? t('presetTag') : t('customTag')}</Tag>
          <Tag tone={status.tone}>{status.text}</Tag>
        </button>
        <div className={css['providerActions']}>
          <button
            type="button"
            className={css['secondaryButton']}
            disabled={!editable || differing.length === 0}
            onClick={onAdopt}
          >
            {t('adoptRoute')}
          </button>
          {dirty
            ? (
              <>
                <button type="button" className={css['secondaryButton']} disabled={busy} onClick={onCancel}>
                  {t('cancel')}
                </button>
                <button type="button" className={css['primaryButton']} disabled={!editable} onClick={onApply}>
                  {busy ? t('applying') : t('apply')}
                </button>
              </>
            )
            : null}
        </div>
      </div>
      {dirty ? <p className={css['dirtyHint']}>{t('dirtyHint')}</p> : null}
      {open
        ? (
          <div className={css['editor']} id={bodyId}>
            {config.error === undefined
              ? null
              : <p className={css['error']}>{t('routeDiagnostic', { message: config.error })}</p>}
            {resolved ? null : <p className={css['hint']}>{t('routeUnresolved')}</p>}
            {preset ? <p className={css['hint']}>{t('presetReadonly')}</p> : null}
            {route.models.length === 0
              ? <p className={css['modelEmpty']}>{t('modelsEmpty')}</p>
              : (
                <div className={css['modelList']}>
                  {route.models.map((row, index) => (
                    <ModelRow
                      key={row.key}
                      row={row}
                      draft={draftOf(row)}
                      preset={preset}
                      disabled={!editable}
                      reasoningCapable={config.reasoningCapable}
                      position={index + 1}
                      t={t}
                      onDraft={(draft) => { onDraft(row.key, draft) }}
                      onOpenEntry={() => { onOpenEntry(row.key) }}
                      onRemove={() => { onRemove(row.key) }}
                    />
                  ))}
                </div>
              )}
            <button type="button" className={css['addModelButton']} disabled={!editable} onClick={onAdd}>
              <IconPlusOutlineRegular size={14} />
              {t('addModel')}
            </button>
          </div>
        )
        : null}
    </li>
  )
}
