/**
 * One configured model as the panel edits it: the identifier and display name
 * on the row, the specification fields behind the disclosure, and the catalog's
 * answer beside every field it publishes.
 *
 * The row is an editor, not a display: its inputs hold staged values through
 * the card that owns them, and the card's Apply is what writes. That is why the
 * adopt actions here fill fields rather than writing — a reader sees exactly
 * what will be stored before it is.
 */

import { useId, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconTrashOutlineRegular, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FieldDifference } from './comparison.ts'
import type { ModelRowView } from './store.ts'
import {
  adoptEntry, adoptField, parseCapacity, type ModelDraft,
} from './draft.ts'
import { CapacityField, ModalitiesField, ReasoningField, type Translate } from './ModelFields.tsx'
import { entryLabel } from './CandidateList.tsx'
import { STRATEGY_KEYS } from './locales.ts'
import css from './ModelsDevPanel.module.css'

/** Props of {@link ModelRow}. */
export interface ModelRowProps {
  /** The stored entry, its catalog answer, and the differences between them. */
  readonly row: ModelRowView
  /** The staged values this row shows. */
  readonly draft: ModelDraft
  /** Whether the route is an adapter preset, which is never written. */
  readonly preset: boolean
  /** Whether every control refuses changes (read-only deployment or a write in flight). */
  readonly disabled: boolean
  /** Whether the route's namespace family accepts a `reasoningEfforts` field at all. */
  readonly reasoningCapable: boolean
  /** One-based position inside the route, for accessible names. */
  readonly position: number
  /** Replace this row's staged values. */
  readonly onDraft: (draft: ModelDraft) => void
  /** Open the dialog that picks which entry this model follows. */
  readonly onOpenEntry: () => void
  /** Ask for confirmation before removing the model. */
  readonly onRemove: () => void
  /** Panel copy. */
  readonly t: Translate
}

/** Whether one difference is about a given stored field. */
function differenceOf(
  differences: readonly FieldDifference[],
  field: FieldDifference['field'],
): FieldDifference | undefined {
  return differences.find(difference => difference.field === field)
}

/**
 * Render one configured model.
 *
 * The disclosure is local state: folding a row is a reading preference, and the
 * panel republishes every row on each read, so holding it above would have to
 * reconcile against rows that moved.
 *
 * @param props - the stored entry, its staged values, and the panel's callbacks.
 * @returns one model entry.
 */
export function ModelRow(props: ModelRowProps): ReactNode {
  const { row, draft, preset, disabled, reasoningCapable, position, onDraft, onOpenEntry, onRemove, t } = props
  const [open, setOpen] = useState(false)
  const fieldId = useId()
  const pinned = row.match.strategy === 'bound'
  const entry = row.match.model
  // The pinned line names the entry, not the id it was looked up by: those differ
  // exactly when a reader pointed a gateway id at the entry that publishes it.
  const matchText = pinned
    ? t('matchPinned', { entry: entryLabel(row.match.providerKey, entry?.id ?? row.match.modelId) })
    : entry === undefined
      ? t('matchNone')
      : t('matchAuto', {
        entry: entryLabel(row.match.providerKey, entry.id),
        strategy: t(STRATEGY_KEYS[row.match.strategy]),
      })
  const contextDifference = differenceOf(row.differences, 'contextWindow')
  const outputDifference = differenceOf(row.differences, 'maxTokens')
  const modalityDifference = differenceOf(row.differences, row.model.modalityField ?? 'input')
  const effortsDifference = differenceOf(row.differences, 'reasoningEfforts')
  const context = parseCapacity(draft.contextWindow)
  const output = parseCapacity(draft.maxTokens)
  return (
    <div className={css['modelEntry']}>
      <div className={css['modelRow']}>
        <input
          className={css['input']}
          type="text"
          value={draft.id}
          placeholder={t('modelId')}
          aria-label={`${t('modelId')} ${String(position)}`}
          disabled={disabled || preset}
          onChange={(event) => { onDraft({ ...draft, id: event.target.value }) }}
        />
        <input
          className={css['input']}
          type="text"
          value={draft.name}
          placeholder={t('modelName')}
          aria-label={`${t('modelName')} ${String(position)}`}
          disabled={disabled || preset}
          onChange={(event) => { onDraft({ ...draft, name: event.target.value }) }}
        />
        {/* Only what the catalog contradicts earns a mark here; the fields
            behind the disclosure spell out which ones. The seat is reserved on
            every row, so a row with no mark is not a narrower row. */}
        <span className={css['modelTags']}>
          {row.differences.length === 0
            ? null
            : <Tag tone="warning">{t('routeDiffering', { count: String(row.differences.length) })}</Tag>}
          {pinned ? <Tag tone="info">{t('pinnedTag')}</Tag> : null}
        </span>
        <button
          type="button"
          className={css['iconButton']}
          aria-label={`${t('modelAdvanced')} ${String(position)}`}
          aria-expanded={open}
          aria-controls={`${fieldId}-specs`}
          title={t('modelAdvanced')}
          onClick={() => { setOpen(value => !value) }}
        >
          {open ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        </button>
        <button
          type="button"
          className={`${css['iconButton']} ${css['iconButtonDanger']}`}
          aria-label={`${t('removeModel')} ${String(position)}`}
          title={t('removeModel')}
          disabled={disabled || preset}
          onClick={onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
      </div>
      {open
        ? (
          <div className={css['modelAdvanced']} id={`${fieldId}-specs`}>
            <CapacityField
              label={t('fieldContext')}
              value={draft.contextWindow}
              published={entry?.contextWindow}
              adopted={context.kind === 'count' && context.value === entry?.contextWindow}
              disabled={disabled || preset}
              t={t}
              onChange={(text) => { onDraft({ ...draft, contextWindow: text }) }}
              {...contextDifference === undefined ? {} : {
                onAdopt: () => { onDraft(adoptField(draft, 'contextWindow', contextDifference.published)) },
              }}
            />
            <CapacityField
              label={t('fieldMaxTokens')}
              value={draft.maxTokens}
              published={entry?.maxOutputTokens}
              adopted={output.kind === 'count' && output.value === entry?.maxOutputTokens}
              disabled={disabled || preset}
              t={t}
              onChange={(text) => { onDraft({ ...draft, maxTokens: text }) }}
              {...outputDifference === undefined ? {} : {
                onAdopt: () => { onDraft(adoptField(draft, 'maxTokens', outputDifference.published)) },
              }}
            />
            {row.model.modalityField === undefined
              ? null
              : (
                <ModalitiesField
                  value={draft.inputModalities}
                  published={entry?.inputModalities}
                  disabled={disabled || preset}
                  t={t}
                  onChange={(modalities) => { onDraft({ ...draft, inputModalities: modalities }) }}
                  {...modalityDifference === undefined ? {} : {
                    onAdopt: () => { onDraft(adoptField(draft, row.model.modalityField!, modalityDifference.published)) },
                  }}
                />
              )}
            {reasoningCapable
              ? (
                <ReasoningField
                  value={draft.reasoning}
                  published={entry?.declaredEfforts}
                  position={position}
                  disabled={disabled || preset}
                  t={t}
                  onChange={(reasoning) => { onDraft({ ...draft, reasoning }) }}
                  {...effortsDifference === undefined ? {} : {
                    onAdopt: () => { onDraft(adoptField(draft, 'reasoningEfforts', effortsDifference.published)) },
                  }}
                />
              )
              : null}
            <div className={css['matchLine']}>
              <span className={css['hint']}>{matchText}</span>
              {entry === undefined || preset
                ? null
                : (
                  <button
                    type="button"
                    className={css['hintAction']}
                    disabled={disabled}
                    onClick={() => { onDraft(adoptEntry(draft, entry)) }}
                  >
                    {t('adopt')}
                  </button>
                )}
              <button type="button" className={css['hintAction']} disabled={disabled || preset} onClick={onOpenEntry}>
                {t('changeEntry')}
              </button>
            </div>
          </div>
        )
        : null}
    </div>
  )
}
