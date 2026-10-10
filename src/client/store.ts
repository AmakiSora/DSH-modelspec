/**
 * Panel state for the models.dev page: the configured routes joined with what
 * the catalog says about them, and the writes that adopt the catalog values.
 * The Host Remote reads and the settings writes are bound here, so a component
 * receives plain data and callbacks only.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LlmConfigurableProvider, SettingsDescribeValue, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { addModelOps, newModelProblem, type NewModelEntry } from './add-model.ts'
import { ModelsDevCatalog } from './catalog-service.ts'
import type { ModelsDevCatalogView, ModelsDevLookup, ModelsDevMatch, ModelsDevOption } from './types.ts'
import { applyOps, compareModel, type FieldDifference } from './comparison.ts'
import { readRoutes, type ConfiguredModel, type ConfiguredRoute } from './configured.ts'

export type { NewModelEntry, NewModelProblem, NewModelTemplate } from './add-model.ts'

/** One configured model with the catalog's answer and the differences it implies. */
export interface ModelRowView {
  /** Panel-stable identity of the model inside its route. */
  readonly key: string
  /** The configured entry, and the address a write uses. */
  readonly model: ConfiguredModel
  /** What the catalog says about the route and this model id. */
  readonly match: ModelsDevMatch
  /** Stored fields the catalog entry contradicts. */
  readonly differences: readonly FieldDifference[]
}

/** One configured route with every model the panel shows for it. */
export interface RouteView {
  /** Panel-stable identity of the route. */
  readonly key: string
  /** The configured route. */
  readonly route: ConfiguredRoute
  /** Its models, in settings order. */
  readonly models: readonly ModelRowView[]
}

/** What the last settings write did. */
export type WriteNotice =
  /** Every selected value reached the namespace. */
  | { readonly kind: 'applied' }
  /** One new model reached the namespace. */
  | { readonly kind: 'added'; readonly id: string }
  /** Another writer changed the namespace since the panel read it. */
  | { readonly kind: 'conflict' }
  /** The namespace refused the edit and said why. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The profile does not accept settings writes. */
  | { readonly kind: 'readonly' }

/** What the add-model dialog is waiting on. */
export interface AddModelState {
  /** Route the model is being added to. */
  readonly routeKey: string
  /** Model id the dialog last asked about. */
  readonly modelId: string
  /** Whether the last search was the fuzzy one rather than the comparisons. */
  readonly fuzzy: boolean
  /** Whether a candidate search is running. */
  readonly searching: boolean
  /** Entries the catalog published for that id, closest first. */
  readonly candidates: readonly ModelsDevOption[]
  /** Why the last search failed, or `null`. */
  readonly error: string | null
}

/** Everything the page renders. */
export interface ModelsDevState {
  /** Whether the first read is running. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** Diagnostic of the failed read, or `null`. */
  readonly error: string | null
  /** Whether the profile accepts settings writes. */
  readonly writable: boolean
  /** Catalog facts of the read that produced `routes`, or `null` before the first success. */
  readonly catalog: ModelsDevCatalogView | null
  /** Whether a catalog re-read is running. */
  readonly refreshing: boolean
  /** Configured routes with their matches, in directory order. */
  readonly routes: readonly RouteView[]
  /** Settings namespaces whose write is in flight. */
  readonly writing: readonly string[]
  /** Outcome of the last write, or `null`. */
  readonly notice: WriteNotice | null
  /** The open add-model dialog, or `null` when none is. */
  readonly add: AddModelState | null
}

/** The data sources and callbacks the panel's slot registration injects. */
export interface ModelsDevFace {
  /** Panel state, bound to `useModelsDev` by the renderer. */
  readonly hooks: { readonly modelsDev: SnapshotStore<ModelsDevState> }
  /** Read on the panel's first mount; a later mount keeps what is held. */
  readonly ensure: () => void
  /** Read the catalog again, ignoring its held lifetime. */
  readonly refresh: () => void
  /** Adopt one model's published values. */
  readonly applyModel: (routeKey: string, modelKey: string) => void
  /** Adopt every differing model of one route. */
  readonly applyRoute: (routeKey: string) => void
  /** Adopt every differing model of every route, one settings write per namespace. */
  readonly applyAll: () => void
  /** Open the add-model dialog for one route. */
  readonly addModel: (routeKey: string) => void
  /** Ask the catalog which entries answer to one model id on one route. */
  readonly searchModel: (routeKey: string, modelId: string) => void
  /** Ask the catalog which entries came close to one model id on one route. */
  readonly searchSimilarModels: (routeKey: string, modelId: string) => void
  /** Append one new model entry to a route's namespace. */
  readonly submitModel: (routeKey: string, entry: NewModelEntry) => void
  /** Close the add-model dialog without writing. */
  readonly cancelAdd: () => void
}

/** One settings write grouped by the namespace it belongs to. */
interface WriteGroup {
  /** Namespace the edits land in. */
  readonly ns: string
  /** Revision the edits were read at. */
  readonly revision: number
  /** The edits themselves. */
  readonly ops: SettingsPathOpView[]
}

/** Key under which one answer is filed; neither a route key nor a model id carries a NUL. */
function answerKey(provider: string, modelId: string): string {
  return `${provider}\u0000${modelId}`
}

/** Panel-stable identity of one configured route. */
function routeKeyOf(route: ConfiguredRoute): string {
  return `${route.settingsNs}/${route.provider}`
}

/** Panel-stable identity of one model inside its route. */
function modelKeyOf(route: ConfiguredRoute, model: ConfiguredModel): string {
  return `${routeKeyOf(route)}/${model.index}`
}

/** The answer for a configured model the catalog returned nothing for. */
function unmatched(provider: string, modelId: string): ModelsDevMatch {
  return { provider, modelId, strategy: 'none' }
}

/**
 * File every answer by the route and model it answers.
 *
 * A route key and a model id together identify one configured entry, because
 * each adapter refuses a duplicate model id inside one route, so the answers
 * can be read back without relying on request order.
 */
function answersBy(matches: readonly ModelsDevMatch[]): Map<string, ModelsDevMatch> {
  return new Map(matches.map(match => [answerKey(match.provider, match.modelId), match]))
}

/** Narrow a Remote answer to its value, so a refusal reaches the caller as a throw. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.value
}

/** The message a caught value reports. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Join the configured routes with the models.dev catalog and adopt what it
 * publishes.
 *
 * One read covers the directory, the settings namespaces, and the catalog, and
 * every model of every route is matched in a single Remote call. A read that
 * settles after a newer one started, or after the panel unloaded, is dropped.
 */
export class ModelsDevController {
  /** Panel state, held even while no panel is mounted. */
  private readonly store: SnapshotStore<ModelsDevState>

  /** Distinguishes overlapping reads; only the newest may publish. */
  private generation = 0

  /**
   * Distinguishes overlapping candidate searches. A read and a search supersede
   * each other for different reasons — one replaces the panel's rows, the other
   * replaces the dialog's list — so they do not share one counter.
   */
  private searches = 0

  /** Whether this controller has been unloaded. */
  private disposed: boolean = false

  /**
   * @param ctx - the browser plugin context whose `remote.llm` and `remote.settings` namespaces answer.
   * @param catalog - the models.dev catalog this panel compares against.
   */
  constructor(private readonly ctx: ClientContext, private readonly catalog: ModelsDevCatalog) {
    this.store = createSnapshotStore<ModelsDevState>({
      status: 'idle',
      error: null,
      writable: false,
      catalog: null,
      refreshing: false,
      routes: [],
      writing: [],
      notice: null,
      add: null,
    })
  }

  /**
   * Read the panel's state.
   * @returns the current snapshot, stable until the next change.
   */
  getSnapshot(): ModelsDevState {
    return this.store.getSnapshot()
  }

  /**
   * Whether this controller has been unloaded. The flag is read through a
   * property so an awaited write cannot keep an earlier check's narrowing.
   * @returns whether the controller was disposed.
   */
  private get unloaded(): boolean {
    return this.disposed
  }

  /** Stop publishing and drop every late settlement. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
  }

  /**
   * Read the deployment's configuration again after it changed elsewhere. The
   * catalog is not read again, because only the configuration moved.
   */
  invalidate(): void {
    if (this.unloaded) return
    this.patch({ status: 'loading', notice: null })
    void this.load(false)
  }

  /**
   * Build the face the panel's slot registration injects.
   * @returns the panel's state source and its actions.
   */
  inject(): ModelsDevFace {
    return {
      hooks: { modelsDev: this.store },
      ensure: () => { if (this.getSnapshot().status === 'idle') void this.load(false) },
      refresh: () => { void this.load(true) },
      applyModel: (routeKey, modelKey) => { void this.apply(this.plan(routeKey, modelKey)) },
      applyRoute: (routeKey) => { void this.apply(this.plan(routeKey, null)) },
      applyAll: () => { void this.apply(this.plan(null, null)) },
      addModel: (routeKey) => { this.openAdd(routeKey) },
      searchModel: (routeKey, modelId) => { void this.search(routeKey, modelId, false) },
      searchSimilarModels: (routeKey, modelId) => { void this.search(routeKey, modelId, true) },
      submitModel: (routeKey, entry) => { void this.submit(routeKey, entry) },
      cancelAdd: () => { this.patch({ add: null }) },
    }
  }

  /**
   * Open the add-model dialog for one route.
   *
   * An adapter preset brings its own profile, so the panel compares it and never
   * writes it; that holds for a model added to it as much as for a corrected
   * value on one it already carries.
   *
   * @param routeKey - the route the model is being added to.
   */
  private openAdd(routeKey: string): void {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    this.patch({ add: { routeKey, modelId: '', fuzzy: false, searching: false, candidates: [], error: null } })
  }

  /**
   * Ask the catalog which entries answer to one model id on one route.
   *
   * The dialog asks on every keystroke, so a search supersedes the one before
   * it and the one before that is dropped rather than published over a longer
   * id. The catalog read behind the answer is shared and cached by the service,
   * so a keystroke that arrives mid-read waits on it instead of starting another.
   *
   * @param routeKey - the route the model is being added to.
   * @param modelId - the id as typed, untrimmed.
   * @param fuzzy - whether to search for ids that merely came close.
   */
  private async search(routeKey: string, modelId: string, fuzzy: boolean): Promise<void> {
    const state = this.getSnapshot()
    const open = state.add
    if (open === null || open.routeKey !== routeKey) return
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined) return
    const wanted = modelId.trim()
    if (wanted === '') {
      this.patch({ add: { ...open, modelId, fuzzy, searching: false, candidates: [], error: null } })
      return
    }
    const search = ++this.searches
    this.patch({ add: { ...open, modelId, fuzzy, searching: true, candidates: [], error: null } })
    try {
      const candidates = fuzzy
        ? await this.catalog.similar(route.route.provider, wanted)
        : await this.catalog.candidates(route.route.provider, wanted)
      const add = this.staleSearch(routeKey, search) ? null : this.getSnapshot().add
      if (add === null) return
      this.patch({ add: { ...add, searching: false, candidates, error: null } })
    } catch (error: unknown) {
      const add = this.staleSearch(routeKey, search) ? null : this.getSnapshot().add
      if (add === null) return
      // A catalog that cannot be read leaves the template in place rather than
      // an empty dialog: the model is still addable, just without its values.
      this.patch({ add: { ...add, searching: false, candidates: [], error: messageOf(error) } })
    }
  }

  /**
   * Append one new model entry to a route's namespace.
   *
   * The write is a single edit and it is guarded by the namespace revision, so a
   * route another window changed underneath the dialog is refused rather than
   * appended to. A draft the route could never accept is dropped here too: the
   * dialog checks the same rules before enabling its confirm button, and a
   * second caller must not reach the namespace with them either.
   *
   * @param routeKey - the route the model is being added to.
   * @param entry - the values to write.
   */
  private async submit(routeKey: string, entry: NewModelEntry): Promise<void> {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ add: null, notice: { kind: 'readonly' } })
      return
    }
    if (newModelProblem(route.route, entry) !== undefined) return
    const ops = addModelOps(route.route, entry)
    this.patch({ writing: [route.route.settingsNs], notice: null })
    try {
      const response = await this.ctx.remote.settings.mutate(route.route.settingsNs, ops, route.route.revision)
      // The write's own outcome is a fact even when the Host broadcast it and a
      // re-read took over underneath: the read counter would drop this
      // settlement and leave the dialog open over a model that is now stored.
      if (this.unloaded) return
      if (!response.ok) {
        this.patch({
          notice: response.error.code === 'settings/conflict'
            ? { kind: 'conflict' }
            : { kind: 'refused', message: response.error.message },
        })
        return
      }
      this.patch({ add: null, notice: { kind: 'added', id: entry.id.trim() } })
      await this.load(false)
    } finally {
      this.patch({ writing: [] })
    }
  }

  /**
   * Group the selected rows into one settings write per namespace.
   *
   * Two routes can share a namespace, and a namespace carries one revision, so
   * a namespace's rows travel together in a single write that the revision
   * still guards. A preset route contributes nothing: the adapter ships that
   * route's profile, so its differences are shown and never written.
   *
   * @param routeKey - the selected route, or `null` for every route.
   * @param modelKey - the selected model inside that route, or `null` for all of them.
   * @returns the writes to run, in route order.
   */
  private plan(routeKey: string | null, modelKey: string | null): WriteGroup[] {
    const groups = new Map<string, WriteGroup>()
    for (const route of this.getSnapshot().routes) {
      if (route.route.preset) continue
      if (routeKey !== null && route.key !== routeKey) continue
      const rows = modelKey === null
        ? route.models
        : route.models.filter(row => row.key === modelKey)
      const ops = rows.flatMap(row => applyOps(route.route, row.model, row.differences))
      if (ops.length === 0) continue
      const existing = groups.get(route.route.settingsNs)
      groups.set(route.route.settingsNs, existing === undefined
        ? { ns: route.route.settingsNs, revision: route.route.revision, ops }
        : { ...existing, ops: [...existing.ops, ...ops] })
    }
    return [...groups.values()]
  }

  /**
   * Write the planned edits, one namespace at a time, and reload afterwards so
   * the panel shows what the deployment now stores. A write that settles after
   * the controller unloaded, or after a newer read took over, is abandoned: the
   * remaining namespaces are left for the next selection.
   * @param groups - the writes to run.
   */
  private async apply(groups: readonly WriteGroup[]): Promise<void> {
    if (groups.length === 0) return
    if (!this.getSnapshot().writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    const generation = this.generation
    this.patch({ writing: groups.map(group => group.ns), notice: null })
    try {
      for (const group of groups) {
        if (this.stale(generation)) return
        const response = await this.ctx.remote.settings.mutate(group.ns, group.ops, group.revision)
        if (this.stale(generation)) return
        if (!response.ok) {
          this.patch({
            notice: response.error.code === 'settings/conflict'
              ? { kind: 'conflict' }
              : { kind: 'refused', message: response.error.message },
          })
          return
        }
      }
      this.patch({ notice: { kind: 'applied' } })
      await this.load(false)
    } finally {
      // Every exit releases the lock. Writing a namespace makes the Host
      // broadcast `settings/document-updated`, which invalidates this very read
      // and supersedes the selection mid-loop; abandoning it without clearing
      // `writing` would leave the whole page disabled for good.
      this.patch({ writing: [] })
    }
  }

  /**
   * Read the directory, the settings namespaces, and the catalog, then publish
   * one answer per configured model.
   * @param force - whether to read the catalog again instead of its held copy.
   */
  private async load(force: boolean): Promise<void> {
    const generation = ++this.generation
    this.patch(force ? { refreshing: true } : { status: 'loading' })
    try {
      const [directory, described] = await Promise.all([this.directory(), this.namespaces()])
      const routes = readRoutes(directory, described)
      const lookups: ModelsDevLookup[] = routes.flatMap(route =>
        route.models.map(model => ({ provider: route.provider, modelId: model.id })))
      // A deployment with no configured model has nothing to compare, so its
      // catalog is left unread; an explicit refresh reads it regardless.
      const compare = force || lookups.length > 0
      const [catalog, matches] = await Promise.all([
        compare ? this.catalog.view(force) : Promise.resolve(null),
        compare ? this.catalog.match(lookups) : Promise.resolve([] as ModelsDevMatch[]),
      ])
      if (this.stale(generation)) return
      const answers = answersBy(matches)
      this.patch({
        status: 'ready',
        error: null,
        writable: described.writable,
        refreshing: false,
        catalog,
        routes: routes.map(route => ({
          key: routeKeyOf(route),
          route,
          models: route.models.map((model) => {
            const match = answers.get(answerKey(route.provider, model.id)) ?? unmatched(route.provider, model.id)
            return { key: modelKeyOf(route, model), model, match, differences: compareModel(model, match) }
          }),
        })),
      })
    } catch (error: unknown) {
      if (this.stale(generation)) return
      this.patch({ status: 'error', error: messageOf(error), refreshing: false })
    }
  }

  /** The provider directory the adapters publish. */
  private async directory(): Promise<readonly LlmConfigurableProvider[]> {
    return unwrap(await this.ctx.remote.llm.listConfigurableProviders())
  }

  /** The redacted settings namespaces. */
  private async namespaces(): Promise<SettingsDescribeValue> {
    return unwrap(await this.ctx.remote.settings.describe())
  }

  /** Whether a settlement arrived too late to matter. */
  private stale(generation: number): boolean {
    return this.unloaded || generation !== this.generation
  }

  /**
   * Whether one candidate search settled too late to publish, either because a
   * newer keystroke replaced it or because its dialog is no longer open.
   */
  private staleSearch(routeKey: string, search: number): boolean {
    if (this.unloaded || search !== this.searches) return true
    const add = this.getSnapshot().add
    return add === null || add.routeKey !== routeKey
  }

  /**
   * Publish the next state.
   * @param next - the fields to replace.
   */
  private patch(next: Partial<ModelsDevState>): void {
    if (this.unloaded) return
    this.store.set({ ...this.getSnapshot(), ...next })
  }
}
