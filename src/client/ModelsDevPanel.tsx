/**
 * The model-specs panel: one card per configured provider route, one row per
 * model inside it, and the catalog's published values beside the fields they
 * would replace.
 *
 * The layout is the harness's own Models settings moved into a sidebar panel —
 * a title, provider cards with a head full of actions and an editing body, and
 * model rows that disclose their specification fields — because that is the
 * surface a reader already knows for exactly these values. What this panel adds
 * is the comparison: every field carries what the catalog publishes for it, and
 * adopting a value stages it in the same editor rather than writing behind the
 * reader.
 *
 * The staged values live here, above the cards, for two reasons: the panel's
 * bulk adopt has to know whether any card holds unsaved edits before it writes,
 * and a draft has to survive its card folding, a re-read, and the card being
 * re-rendered from a newer snapshot.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  Button, IconRefreshOutlineRegular, IconSettingsOutlineRegular, StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NOTICE_KEYS, PROBLEM_KEYS } from './locales.ts'
import type { ModelsDevFace, ModelRowView, RouteView, WriteNotice } from './store.ts'
import { adoptEntry, draftDiffers, draftOf, type ModelDraft } from './draft.ts'
import type { ModelsDevOption } from './types.ts'
import { ProviderCard } from './ProviderCard.tsx'
import { AddModelDialog } from './AddModelDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { RemoveModelDialog } from './RemoveModelDialog.tsx'
import { CatalogSettingsDialog } from './CatalogSettingsDialog.tsx'
import { DEFAULT_CATALOG_ENDPOINT } from './catalog-endpoint.ts'
import css from './ModelsDevPanel.module.css'

/** Full component props assembled by the main slot renderer. */
export type ModelsDevPanelProps =
  & PropsRuntime<'main'>
  & PropsLocale<'modelsDev'>
  & InjectFace<ModelsDevFace>

/** The panel's dictionary seat. */
type Translate = ModelsDevPanelProps['t']

/** The status line one write outcome renders. */
function noticeText(notice: WriteNotice, t: Translate): string {
  if (notice.kind === 'added') return t('noticeAdded', { id: notice.id })
  if (notice.kind === 'removed') return t('noticeRemoved', { id: notice.id })
  if (notice.kind === 'refused') return t('noticeRefused', { message: notice.message })
  if (notice.kind === 'invalid') return t('noticeInvalid', { problem: t(PROBLEM_KEYS[notice.problem]) })
  return t(NOTICE_KEYS[notice.kind])
}

/** The dot tone one notice renders with. */
function noticeTone(notice: WriteNotice): StateDotState {
  if (notice.kind !== 'conflict' && notice.kind !== 'refused' && notice.kind !== 'readonly' && notice.kind !== 'invalid') {
    return 'done'
  }
  return notice.kind === 'conflict' ? 'warning' : 'error'
}

/** Where a removal confirmation is waiting. */
interface RemovalTarget {
  /** Route the model belongs to. */
  readonly routeKey: string
  /** The model being removed. */
  readonly modelKey: string
}

/**
 * Render the model-specs panel.
 * @param props - the slot shares: the panel's dictionary, its state source, and its actions.
 * @returns the panel element.
 */
export function ModelsDevPanel({
  t, useModelsDev, ensure, refresh, openSettings, saveEndpoint, cancelSettings, adoptAll, saveRoute,
  openAdd, openEntry, searchModel, discoverModels, addModel, bindEntry, removeModel, cancelEditor,
}: ModelsDevPanelProps): ReactNode {
  useEffect(() => { ensure() }, [ensure])
  const state = useModelsDev(snapshot => snapshot)
  const [drafts, setDrafts] = useState<ReadonlyMap<string, ModelDraft>>(() => new Map())
  const [removing, setRemoving] = useState<RemovalTarget | null>(null)

  /**
   * The staged values of one row.
   *
   * A draft is only shown while the model it was opened from is still the model
   * at its address: a re-read can shift rows (a removal in another window, say),
   * and rendering the shifted draft would attribute one model's edits to
   * another. A draft that no longer matches is simply not shown, and the row
   * falls back to what the deployment stores.
   */
  const draftFor = (row: ModelRowView): ModelDraft => {
    const staged = drafts.get(row.key)
    return staged !== undefined && staged.baseId === row.model.id ? staged : draftOf(row.model)
  }

  const stage = (modelKey: string, draft: ModelDraft): void => {
    setDrafts((current) => {
      const next = new Map(current)
      next.set(modelKey, draft)
      return next
    })
  }

  const isDirty = (row: ModelRowView): boolean => draftDiffers(draftFor(row), row.model)
  const routeDirty = (route: RouteView): boolean => route.models.some(isDirty)
  const anyDirty = state.routes.some(routeDirty)

  /** Adopt every published value the route's rows do not already stage. */
  const adoptRoute = (route: RouteView): void => {
    setDrafts((current) => {
      const next = new Map(current)
      for (const row of route.models) {
        const entry = row.match.model
        if (entry === undefined) continue
        const staged = current.get(row.key)
        const draft = staged !== undefined && staged.baseId === row.model.id ? staged : draftOf(row.model)
        next.set(row.key, adoptEntry(draft, entry))
      }
      return next
    })
  }

  /** Discard one route's staged values. */
  const discardRoute = (route: RouteView): void => {
    setDrafts((current) => {
      const next = new Map(current)
      for (const row of route.models) next.delete(row.key)
      return next
    })
  }

  /** Commit one route's staged values; the store skips the rows that changed nothing. */
  const applyRoute = (route: RouteView): void => {
    saveRoute(route.key, route.models.map(row => ({ modelKey: row.key, draft: draftFor(row) })))
  }

  const editor = state.editor
  const editorRoute = editor === null ? undefined : state.routes.find(route => route.key === editor.routeKey)
  const editorRow = editor === null || editor.modelKey === null
    ? undefined
    : editorRoute?.models.find(row => row.key === editor.modelKey)
  const removingRoute = removing === null ? undefined : state.routes.find(route => route.key === removing.routeKey)
  const removingRow = removingRoute?.models.find(row => row.key === removing?.modelKey)
  const catalogAvailable = state.catalog !== null && state.catalogError === null

  /** Pin the entry the open dialog chose, and fill the card from it when asked. */
  const confirmEntry = (option: ModelsDevOption | undefined, adoptValues: boolean): void => {
    if (editorRow === undefined) return
    if (adoptValues && option !== undefined) {
      stage(editorRow.key, adoptEntry(draftFor(editorRow), option.model))
    }
    bindEntry(option === undefined ? null : { providerId: option.providerId, modelId: option.model.id })
  }

  return (
    <div className={css['page']}>
      <header className={css['header']}>
        <div className={css['headerText']}>
          <h1 className={css['title']}>{t('title')}</h1>
          <p className={css['intro']}>{t('intro')}</p>
          {state.catalog === null
            ? null
            : (
              <p className={css['meta']}>
                {t('catalogMeta', {
                  source: state.catalog.source,
                  models: String(state.catalog.modelCount),
                })}
                {' · '}
                {t('catalogUpdated', { time: new Date(state.catalog.fetchedAt).toLocaleString() })}
              </p>
            )}
        </div>
        <div className={css['headerActions']}>
          <Button
            variant="outline"
            size="sm"
            icon={<IconRefreshOutlineRegular size={13} />}
            disabled={state.refreshing || state.writing.length > 0}
            onClick={refresh}
            aria-label={t('refresh')}
          >
            {state.refreshing ? t('refreshing') : t('refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<IconSettingsOutlineRegular size={13} />}
            onClick={openSettings}
            aria-label={t('catalogSettings')}
          >
            {t('catalogSettings')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={anyDirty || state.writing.length > 0 || !state.writable}
            title={anyDirty ? t('adoptAllBlocked') : undefined}
            onClick={adoptAll}
          >
            {t('adoptAll')}
          </Button>
        </div>
      </header>
      <div className={css['body']}>
        {state.catalogError === null
          ? null
          : (
            <p className={css['diagnostic']} role="alert">
              <strong>{t('errorTitle')}</strong>
              {state.catalogError}
              <span className={css['meta']}>{t('catalogUnavailable')}</span>
            </p>
          )}
        {state.notice === null
          ? null
          : (
            <p className={css['notice']} role="status">
              <StateDot appearance="step" state={noticeTone(state.notice)} />
              {noticeText(state.notice, t)}
            </p>
          )}
        {/* The profile's write permission is only known once the read lands, so
            the warning waits for it rather than flashing on every first paint. */}
        {state.status === 'ready' && !state.writable ? <p className={css['diagnostic']}>{t('readOnly')}</p> : null}
        {state.status === 'loading' ? <p className={css['meta']}>{t('loading')}</p> : null}
        {state.status === 'error'
          ? (
            <div className={css['diagnostic']} role="alert">
              <strong>{t('errorTitle')}</strong>
              {state.error}
            </div>
          )
          : null}
        {state.status === 'ready' && state.routes.length === 0
          ? <p className={css['diagnostic']}>{t('empty')}</p>
          : null}
        <ul className={css['providerList']}>
          {state.routes.map(route => (
            <ProviderCard
              key={route.key}
              route={route}
              draftOf={draftFor}
              dirty={routeDirty(route)}
              busy={state.writing.includes(route.route.settingsNs)}
              writable={state.writable}
              catalogAvailable={catalogAvailable}
              t={t}
              onDraft={stage}
              onAdopt={() => { adoptRoute(route) }}
              onCancel={() => { discardRoute(route) }}
              onApply={() => { applyRoute(route) }}
              onAdd={() => { openAdd(route.key) }}
              onOpenEntry={(modelKey) => { openEntry(route.key, modelKey) }}
              onRemove={(modelKey) => { setRemoving({ routeKey: route.key, modelKey }) }}
            />
          ))}
        </ul>
      </div>
      {state.editor !== null && state.editor.mode === 'add' && editorRoute !== undefined
        ? (
          <AddModelDialog
            route={editorRoute}
            editor={state.editor}
            writable={state.writable}
            busy={state.writing.includes(editorRoute.route.settingsNs)}
            t={t}
            onSearch={searchModel}
            onDiscover={discoverModels}
            onSubmit={addModel}
            onClose={cancelEditor}
          />
        )
        : null}
      {state.editor !== null && state.editor.mode === 'entry' && editorRoute !== undefined && editorRow !== undefined
        ? (
          <EntryDialog
            route={editorRoute}
            row={editorRow}
            editor={state.editor}
            writable={state.writable}
            busy={state.writing.includes(editorRoute.route.settingsNs)}
            t={t}
            onSearch={searchModel}
            onConfirm={confirmEntry}
            onClose={cancelEditor}
          />
        )
        : null}
      {removing === null || removingRoute === undefined || removingRow === undefined
        ? null
        : (
          <RemoveModelDialog
            route={removingRoute}
            modelId={removingRow.model.id}
            last={removingRoute.models.length === 1}
            busy={state.writing.includes(removingRoute.route.settingsNs)}
            t={t}
            onConfirm={() => {
              removeModel(removing.routeKey, removing.modelKey)
              setRemoving(null)
            }}
            onClose={() => { setRemoving(null) }}
          />
        )}
      <CatalogSettingsDialog
        open={state.settingsOpen}
        endpoint={state.catalogEndpoint}
        defaultEndpoint={DEFAULT_CATALOG_ENDPOINT}
        t={t}
        onSave={saveEndpoint}
        onClose={cancelSettings}
      />
    </div>
  )
}
