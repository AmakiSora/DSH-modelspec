/**
 * The models.dev panel: one card per configured provider route, one row per
 * configured model inside it, and the fields the catalog entry contradicts.
 * Everything the page renders arrives through its props; it holds no Host
 * access and no subscription of its own.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconEditOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
  StateDot, Tag, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FieldDifference } from './comparison.ts'
import { FIELD_KEYS, STRATEGY_KEYS } from './locales.ts'
import type { ModelRowView, ModelsDevFace, ModelsDevState, RouteView, WriteNotice } from './store.ts'
import { AddModelDialog } from './AddModelDialog.tsx'
import { EditModelDialog } from './EditModelDialog.tsx'
import css from './ModelsDevPage.module.css'

/** Full component props assembled by the main slot renderer. */
export type ModelsDevPageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'modelsDev'>
  & InjectFace<ModelsDevFace>

/** The page's dictionary seat. */
type Translate = ModelsDevPageProps['t']

/** One stored value rendered the way the panel shows it. */
function valueText(difference: FieldDifference, side: 'configured' | 'published', t: Translate): string {
  const value = difference[side]
  if (value === undefined) return t('unset')
  if (typeof value === 'number') return String(value)
  return value.map(modality => t(modality === 'image' ? 'modalityImage' : 'modalityText')).join(' + ')
}

/** The status line one write outcome renders. */
function noticeText(notice: WriteNotice, t: Translate): string {
  if (notice.kind === 'applied') return t('noticeApplied')
  if (notice.kind === 'added') return t('noticeAdded', { id: notice.id })
  if (notice.kind === 'saved') return t('noticeSaved')
  if (notice.kind === 'conflict') return t('noticeConflict')
  if (notice.kind === 'readonly') return t('noticeReadonly')
  return t('noticeRefused', { message: notice.message })
}

/** The dot tone one notice renders with. */
function noticeTone(notice: WriteNotice): StateDotState {
  if (notice.kind === 'applied' || notice.kind === 'added' || notice.kind === 'saved') return 'done'
  return notice.kind === 'conflict' ? 'warning' : 'error'
}

/** The capability flags a catalog entry publishes, with one localized line each. */
function capabilityLabels(row: ModelRowView, t: Translate): string[] {
  const model = row.match.model
  if (model === undefined) return []
  const answer = (supported: boolean): string => (supported ? t('capYes') : t('capNo'))
  return [
    `${t('capReasoning')} · ${answer(model.reasoning)}`,
    `${t('capToolCall')} · ${answer(model.toolCall)}`,
    `${t('capStructured')} · ${answer(model.structuredOutput)}`,
    `${t('capTemperature')} · ${answer(model.temperature)}`,
  ]
}

/** The published price line, or `null` when the entry publishes no price. */
function priceText(row: ModelRowView, t: Translate): string | null {
  const cost = row.match.model?.cost
  if (cost === undefined) return null
  const { input, output } = cost
  if (input !== undefined && output !== undefined) {
    return t('priceLabel', { input: String(input), output: String(output) })
  }
  return t('pricePartial', { input: input === undefined ? '-' : String(input), output: output === undefined ? '-' : String(output) })
}

/** The line naming which provider the located entry came from. */
function matchMetaText(row: ModelRowView, t: Translate): string {
  const via = t('matchedVia', { strategy: t(STRATEGY_KEYS[row.match.strategy]) })
  return row.match.providerKey === undefined ? via : `${via} · ${t('matchedProvider', { provider: row.match.providerKey })}`
}

/** One configured model with the catalog's answer about it. */
function ModelCard({ row, busy, preset, writable, onApply, onEdit, t }: {
  readonly row: ModelRowView
  readonly busy: boolean
  /** The route is an adapter preset, so the panel offers no write for it. */
  readonly preset: boolean
  /** The deployment accepts settings writes at all. */
  readonly writable: boolean
  readonly onApply: () => void
  readonly onEdit: () => void
  readonly t: Translate
}): ReactNode {
  const { model, match, differences } = row
  const capabilities = capabilityLabels(row, t)
  const price = priceText(row, t)
  const pinned = match.strategy === 'bound'
  return (
    <li className={css.model}>
      <div className={css.modelHead}>
        <span className={css.modelName}>{model.name ?? model.id}</span>
        {model.name === undefined ? null : <code className={css.modelId}>{model.id}</code>}
        {match.model?.status === 'deprecated' ? <Tag tone="warning">{t('deprecatedTag')}</Tag> : null}
        {pinned ? <Tag tone="info">{t('modelPinnedTag')}</Tag> : null}
        <div className={css.modelActions}>
          {differences.length === 0 || preset ? null : (
            <Button variant="outline" size="sm" disabled={busy || !writable} onClick={onApply}>{t('applyModel')}</Button>
          )}
          <Button variant="ghost" size="sm" icon={<IconEditOutlineRegular size={13} />}
            disabled={preset || busy || !writable} onClick={onEdit} aria-label={t('editModel')}>
            {t('editModel')}
          </Button>
        </div>
      </div>
      {match.strategy === 'none'
        ? <p className={css.unmatched}>{t('unmatched')}</p>
        : (
          <>
            <p className={css.meta}>{matchMetaText(row, t)}</p>
            {differences.length === 0
              ? <p className={css.upToDate}>{t('upToDate')}</p>
              : (
                <dl className={css.fields}>
                  {differences.map(difference => (
                    <div className={css.field} key={difference.field}>
                      <dt className={css.fieldName}>{t(FIELD_KEYS[difference.field])}</dt>
                      <dd className={css.fieldValues}>
                        <span className={css.valueConfigured}>{valueText(difference, 'configured', t)}</span>
                        <span className={css.valueTo}>{t('valueTo')}</span>
                        <span className={css.valuePublished}>{valueText(difference, 'published', t)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
          </>
        )}
      {capabilities.length === 0 ? null : (
        <ul className={css.capabilities}>
          {capabilities.map(label => <li className={css.capability} key={label}>{label}</li>)}
        </ul>
      )}
      {match.model?.description === undefined ? null : <p className={css.description}>{match.model.description}</p>}
      {price === null ? null : <p className={css.meta}>{price}</p>}
      {match.model?.releaseDate === undefined
        ? null
        : <p className={css.meta}>{t('releaseDate', { date: match.model.releaseDate })}</p>}
    </li>
  )
}

/** One configured provider route and the models it declares. */
function RouteCard({ route, state, onApplyRoute, onApplyModel, onAddModel, onEditModel, t }: {
  readonly route: RouteView
  readonly state: ModelsDevState
  readonly onApplyRoute: () => void
  readonly onApplyModel: (modelKey: string) => void
  readonly onAddModel: () => void
  readonly onEditModel: (modelKey: string) => void
  readonly t: Translate
}): ReactNode {
  const config = route.route
  const preset = config.preset
  const differing = route.models.some(row => row.differences.length > 0)
  const busy = state.writing.includes(config.settingsNs)
  const resolved = route.models.some(row => row.match.routeProviderKey !== undefined)
  // Only the component knows which routes the reader folded away, so the fold
  // is local state: it survives a re-read, which republishes every row.
  const [open, setOpen] = useState(true)
  const differingCount = route.models.filter(row => row.differences.length > 0).length
  return (
    <section className={css.route}>
      <div className={css.routeHead}>
        <button
          type="button"
          className={css.routeToggle}
          aria-expanded={open}
          aria-controls={route.key}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconChevronDownOutlineRegular
            size={14}
            aria-hidden="true"
            className={open ? css.chevronOpen : css.chevronClosed}
          />
          <h2 className={css.routeName}>{config.displayName}</h2>
          <code className={css.routeKey}>{config.provider}</code>
          <Tag tone={differing ? 'warning' : 'success'}>
            {differing ? t('routeDiffering', { count: differingCount }) : t('routeMatching')}
          </Tag>
        </button>
        {preset ? <Tag tone="neutral">{t('routePreset')}</Tag> : null}
        <Button variant="outline" size="sm" icon={<IconPlusOutlineRegular size={13} />}
          disabled={preset || busy || !state.writable} onClick={onAddModel}>
          {t('addModel')}
        </Button>
        <Button variant="outline" size="sm" disabled={!differing || preset || busy || !state.writable} onClick={onApplyRoute}>
          {t('applyRoute')}
        </Button>
      </div>
      {!open
        ? null
        : (
          <>
            {config.error === undefined ? null : (
              <p className={css.diagnostic}>{t('routeDiagnostic', { message: config.error })}</p>
            )}
            {!resolved ? <p className={css.diagnostic}>{t('routeUnresolved')}</p> : null}
            <ul className={css.models} id={route.key}>
              {route.models.map(row => (
                <ModelCard key={row.key} row={row} busy={busy} preset={preset} writable={state.writable} t={t}
                  onApply={() => { onApplyModel(row.key) }}
                  onEdit={() => { onEditModel(row.key) }} />
              ))}
            </ul>
          </>
        )}
    </section>
  )
}

/**
 * Render the models.dev panel.
 * @param props - the slot shares: the panel's own dictionary, its state source, and its actions.
 * @returns the panel element.
 */
export function ModelsDevPage({
  t, useModelsDev, ensure, refresh, applyModel, applyRoute, applyAll,
  pickModel, searchModel, addModel, saveModel, cancelPick,
}: ModelsDevPageProps): ReactNode {
  useEffect(() => { ensure() }, [ensure])
  const state = useModelsDev(snapshot => snapshot)
  // A preset route's differences are shown but never adopted, so they do not
  // make the page-level write worth offering either.
  const differing = state.routes.some(route =>
    !route.route.preset && route.models.some(row => row.differences.length > 0))
  const busy = state.writing.length > 0
  const pickerRoute = state.picker === null ? undefined : state.routes.find(route => route.key === state.picker?.routeKey)
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.headerText}>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <div className={css.headerActions}>
          <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={13} />}
            disabled={state.refreshing || busy} onClick={refresh} aria-label={t('refresh')}>
            {state.refreshing ? t('refreshing') : t('refresh')}
          </Button>
          <Button variant="primary" size="sm" disabled={!differing || busy || !state.writable} onClick={applyAll}>
            {t('applyAll')}
          </Button>
        </div>
      </header>
      <div className={css.body}>
        {state.catalog === null ? null : (
          <p className={css.meta}>
            {t('catalogMeta', {
              source: state.catalog.source,
              models: String(state.catalog.modelCount),
              providers: String(state.catalog.providers.length),
            })}
            {' · '}
            {t('catalogUpdated', { time: new Date(state.catalog.fetchedAt).toLocaleString() })}
          </p>
        )}
        {state.notice === null ? null : (
          <p className={css.notice} role="status">
            <StateDot appearance="step" state={noticeTone(state.notice)} />
            {noticeText(state.notice, t)}
          </p>
        )}
        {state.writable ? null : <p className={css.diagnostic}>{t('readOnly')}</p>}
        {state.status === 'loading' ? <p className={css.meta}>{t('loading')}</p> : null}
        {state.status === 'error' ? (
          <div className={css.diagnostic} role="alert">
            <strong>{t('errorTitle')}</strong>
            {state.error}
          </div>
        ) : null}
        {state.status === 'ready' && state.routes.length === 0
          ? <p className={css.diagnostic}>{t('empty')}</p>
          : null}
        {state.routes.map(route => (
          <RouteCard key={route.key} route={route} state={state} t={t}
            onApplyRoute={() => { applyRoute(route.key) }}
            onApplyModel={(modelKey) => { applyModel(route.key, modelKey) }}
            onAddModel={() => { pickModel(route.key, null) }}
            onEditModel={(modelKey) => { pickModel(route.key, modelKey) }} />
        ))}
      </div>
      {pickerRoute === undefined || state.picker === null ? null : state.picker.modelKey === null ? (
        <AddModelDialog
          route={pickerRoute}
          picker={state.picker}
          writable={state.writable}
          busy={state.writing.includes(pickerRoute.route.settingsNs)}
          t={t}
          onSearch={searchModel}
          onSubmit={addModel}
          onClose={cancelPick}
        />
      ) : (
        <EditModelDialog
          route={pickerRoute}
          row={pickerRoute.models.find(row => row.key === state.picker?.modelKey) ?? pickerRoute.models[0]!}
          picker={state.picker}
          writable={state.writable}
          busy={state.writing.includes(pickerRoute.route.settingsNs)}
          t={t}
          onSearch={searchModel}
          onSubmit={saveModel}
          onClose={cancelPick}
        />
      )}
    </div>
  )
}
