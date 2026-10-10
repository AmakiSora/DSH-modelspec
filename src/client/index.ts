/**
 * models.dev panel, browser half: the sidebar entry that opens the page, and
 * the page itself. The page reads the configured provider routes and their
 * model entries through the settings Remote, asks the `modelsDev` Remote what
 * the published catalog says about each of them, and writes the differences
 * back as path-addressed settings edits.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the root `main` keyed slot the page registers into, declared by
// ui-layout with the panel id brand, and the `sidebar.panellist` list the entry
// registers into, declared by ui-sidebar.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the locale plugin's Context merge (ctx.locale) and the renderer's
// slot-prop faces.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge, the settings and llm payload
// vocabulary, and the `modelsDev` Remote this page's reads arrive through.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsDevCatalog } from './catalog-service.ts'
import { ModelsDevPage } from './ModelsDevPage.tsx'
import { ModelsDevPanelIcon } from './ModelsDevPanelIcon.tsx'
import { en, zh, type ModelsDevLocaleKey } from './locales.ts'
import { ModelsDevController } from './store.ts'

export type { ModelsDevPageProps } from './ModelsDevPage.tsx'
export type { ModelsDevState, WriteNotice } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** models.dev panel copy. */
    'modelsDev': ModelsDevLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'modelsDev'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'models-dev' as MainPanelId

/** Services the panel reads and writes through; the directory answers which routes exist. */
export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings']

/**
 * Contribute the model-specs entry to the sidebar and the panel it opens, and
 * keep the panel current when the deployment's configuration changes.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-aid: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new ModelsDevController(ctx, new ModelsDevCatalog())
  const face = controller.inject()
  ctx.effect(() => () => { controller.dispose() }, 'model-aid: controller')
  // The Host says when a settings namespace changed — from this page, the
  // Models settings page, the CLI, or another browser — so a comparison never
  // sits on top of a configuration that has moved. A catalog read is not
  // repeated: only the deployment's own configuration is what moved.
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { controller.invalidate() }),
      ctx.on('connection/reset', () => { controller.invalidate() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'model-aid: host invalidations')

  // The page is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => face,
  }, ModelsDevPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('panel'),
    locale: NS,
  }, ModelsDevPanelIcon))
}
