/**
 * Panel state for the models.dev page: the configured routes joined with what
 * the catalog says about them, the writes that adopt the catalog values, and
 * the picker that adds or edits one model. The Host Remote reads, the settings
 * writes, and the browser-local entry bindings are bound here, so a component
 * receives plain data and callbacks only.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  LlmConfigurableProvider, LlmDiscoveredModel, SettingsDescribeValue, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { addModelOps, newModelProblem, type NewModelEntry } from './add-model.ts'
import { bindingHost, bindingKey, readBindings, writeBinding, type EntryBinding } from './bindings.ts'
import { writeCatalogEndpoint } from './catalog-endpoint.ts'
import { ModelsDevCatalog } from './catalog-service.ts'
import type { ModelsDevCatalogView, ModelsDevLookup, ModelsDevMatch, ModelsDevOption } from './types.ts'
import { applyOps, compareModel, editOps, removeModelOps, type EditedModel, type FieldDifference } from './comparison.ts'
import { readRoutes, type ConfiguredModel, type ConfiguredRoute } from './configured.ts'

export type { NewModelEntry, NewModelProblem, NewModelTemplate } from './add-model.ts'
export type { EditedModel } from './comparison.ts'
export type { EntryBinding } from './bindings.ts'

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
  /** One edited model reached the namespace. */
  | { readonly kind: 'saved' }
  /** One model was removed from the namespace. */
  | { readonly kind: 'removed'; readonly id: string }
  /** Another writer changed the namespace since the panel read it. */
  | { readonly kind: 'conflict' }
  /** The namespace refused the edit and said why. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The profile does not accept settings writes. */
  | { readonly kind: 'readonly' }

/** What the model picker is waiting on. */
export interface ModelPickerState {
  /** Route the model belongs to, or is being added to. */
  readonly routeKey: string
  /** The model being edited, or `null` when a model is being added. */
  readonly modelKey: string | null
  /** Model id the picker last asked about. */
  readonly modelId: string
  /** Whether the last search was the fuzzy one rather than the comparisons. */
  readonly fuzzy: boolean
  /** Whether a candidate search is running. */
  readonly searching: boolean
  /** Entries the catalog published for that id, closest first. */
  readonly candidates: readonly ModelsDevOption[]
  /** Why the last search failed, or `null`. */
  readonly error: string | null
  /** Whether the route's own endpoint is being asked which models it serves. */
  readonly discovering: boolean
  /**
   * What that endpoint answered, or `null` while it has not answered yet. An
   * empty list is an answer too: the endpoint reported no models.
   */
  readonly discovered: readonly LlmDiscoveredModel[] | null
  /** Why the last interrogation failed, or `null`. */
  readonly discoverError: string | null
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
  /** Why the catalog could not be read this round, or `null` when it answered. */
  readonly catalogError: string | null
  /** Whether a catalog re-read is running. */
  readonly refreshing: boolean
  /** Configured routes with their matches, in directory order. */
  readonly routes: readonly RouteView[]
  /** Settings namespaces whose write is in flight. */
  readonly writing: readonly string[]
  /** Outcome of the last write, or `null`. */
  readonly notice: WriteNotice | null
  /** The open picker, or `null` when none is. */
  readonly picker: ModelPickerState | null
  /** The address the catalog is read from, which the settings dialog edits. */
  readonly catalogEndpoint: string
  /** Whether the catalog settings dialog is open. */
  readonly settingsOpen: boolean
}

/** The data sources and callbacks the panel's slot registration injects. */
export interface ModelsDevFace {
  /** Panel state, bound to `useModelsDev` by the renderer. */
  readonly hooks: { readonly modelsDev: SnapshotStore<ModelsDevState> }
  /** Read on the panel's first mount; a later mount keeps what is held. */
  readonly ensure: () => void
  /** Read the catalog again, ignoring its held lifetime. */
  readonly refresh: () => void
  /** Open the catalog settings dialog. */
  readonly openSettings: () => void
  /** Point the catalog at another address, keep it for this browser, and read again. */
  readonly saveEndpoint: (endpoint: string) => void
  /** Close the settings dialog without changing anything. */
  readonly cancelSettings: () => void
  /** Adopt one model's published values. */
  readonly applyModel: (routeKey: string, modelKey: string) => void
  /** Adopt every differing model of one route. */
  readonly applyRoute: (routeKey: string) => void
  /** Adopt every differing model of every route, one settings write per namespace. */
  readonly applyAll: () => void
  /** Open the picker for a route, or for one model inside it. */
  readonly pickModel: (routeKey: string, modelKey: string | null) => void
  /** Ask the catalog about one model id for the open picker. */
  readonly searchModel: (modelId: string, fuzzy: boolean) => void
  /** Ask the picker's route which models its own endpoint serves. */
  readonly discoverModels: () => void
  /** Append a new model entry to the route the open picker belongs to, following the entry it was filled from. */
  readonly addModel: (entry: NewModelEntry, binding: EntryBinding | undefined) => void
  /** Write one edited model back, against the entry source it should follow. */
  readonly saveModel: (edited: EditedModel, binding: EntryBinding | undefined) => void
  /** Remove one model from a route's namespace. */
  readonly removeModel: (routeKey: string, modelKey: string) => void
  /** Close the picker without writing. */
  readonly cancelPick: () => void
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

/**
 * Swallow one catalog failure into the values a read survives it with.
 *
 * The page renders configured rows whether or not the catalog answered, so a
 * network failure — this browser's own reach, not the deployment's state — is
 * carried beside the rows as a diagnostic instead of cancelling the whole
 * read. The matches read rides the same fate: no catalog means no answers, and
 * every row reports itself unmatched.
 * @param error - the catalog read's failure.
 * @returns the failure's message and the absent facts it leaves behind.
 */
function catalogFailure(error: unknown): { readonly catalog: null; readonly catalogError: string } {
  return { catalog: null, catalogError: messageOf(error) }
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
   * replaces the picker's list — so they do not share one counter.
   */
  private searches = 0

  /**
   * Distinguishes overlapping endpoint interrogations, for the same reason:
   * two presses of the fetch button are two answers, and only the newer one
   * describes what the endpoint currently serves.
   */
  private discoveries = 0

  /**
   * Host the entry bindings beside this panel belong to, read once: a panel
   * cannot outlive the window it was served from, and re-reading per comparison
   * would let a storage the browser refuses to answer cost every read.
   */
  private readonly host: string = bindingHost()

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
      catalogError: null,
      refreshing: false,
      routes: [],
      writing: [],
      notice: null,
      picker: null,
      catalogEndpoint: catalog.source,
      settingsOpen: false,
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
   * Point the catalog at another address, remember it for this browser, and
   * read again.
   *
   * The address is kept per host beside the panel, exactly as the entry
   * bindings are: the fetch belongs to this browser, so a network that cannot
   * reach the published endpoint is one only the reader can answer for. A
   * changed address drops the held copy, and the dialog stays open over the
   * failure when the new one cannot be read either.
   *
   * @param endpoint - the address to read the catalog from.
   */
  private async retarget(endpoint: string): Promise<void> {
    const address = endpoint.trim()
    if (address === '') return
    writeCatalogEndpoint(bindingHost(), address)
    this.catalog.retarget(address)
    this.patch({ catalogEndpoint: address, settingsOpen: false, status: 'loading', error: null, catalogError: null })
    await this.load(true)
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
      openSettings: () => { this.patch({ settingsOpen: true }) },
      saveEndpoint: (endpoint) => { void this.retarget(endpoint) },
      cancelSettings: () => { this.patch({ settingsOpen: false }) },
      applyModel: (routeKey, modelKey) => { void this.apply(this.plan(routeKey, modelKey)) },
      applyRoute: (routeKey) => { void this.apply(this.plan(routeKey, null)) },
      applyAll: () => { void this.apply(this.plan(null, null)) },
      pickModel: (routeKey, modelKey) => { this.open(routeKey, modelKey) },
      searchModel: (modelId, fuzzy) => { void this.search(modelId, fuzzy) },
      discoverModels: () => { void this.discover() },
      addModel: (entry, binding) => { void this.append(entry, binding) },
      saveModel: (edited, binding) => { void this.save(edited, binding) },
      removeModel: (routeKey, modelKey) => { void this.remove(routeKey, modelKey) },
      cancelPick: () => { this.patch({ picker: null }) },
    }
  }

  /**
   * Open the picker for a route, or for one model inside it.
   *
   * An adapter preset brings its own profile, so the panel compares it and never
   * writes it; that holds for a model added to it as much as for a corrected
   * value on one it already carries. The picker is the only place either is
   * offered, so refusing it here refuses both at once.
   *
   * @param routeKey - the route the model belongs to, or is being added to.
   * @param modelKey - the model being edited, or `null` to add one.
   */
  private open(routeKey: string, modelKey: string | null): void {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined || route.route.preset) return
    if (modelKey !== null && !route.models.some(row => row.key === modelKey)) return
    if (!state.writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    this.patch({
      picker: {
        routeKey,
        modelKey,
        modelId: '',
        fuzzy: false,
        searching: false,
        candidates: [],
        error: null,
        discovering: false,
        discovered: null,
        discoverError: null,
      },
    })
  }

  /**
   * Ask the catalog which entries answer to the model id the open picker holds.
   *
   * The picker asks on every keystroke, so a search supersedes the one before it
   * and the one before that is dropped rather than published over a longer id.
   * The catalog read behind the answer is shared and cached by the service, so a
   * keystroke that arrives mid-read waits on it instead of starting another.
   *
   * @param modelId - the id as typed, untrimmed.
   * @param fuzzy - whether to search for ids that merely came close.
   */
  private async search(modelId: string, fuzzy: boolean): Promise<void> {
    const state = this.getSnapshot()
    const open = state.picker
    if (open === null) return
    const route = state.routes.find(row => row.key === open.routeKey)
    if (route === undefined) return
    const wanted = modelId.trim()
    if (wanted === '') {
      this.patch({ picker: { ...open, modelId, fuzzy, searching: false, candidates: [], error: null } })
      return
    }
    const search = ++this.searches
    this.patch({ picker: { ...open, modelId, fuzzy, searching: true, candidates: [], error: null } })
    try {
      const candidates = fuzzy
        ? await this.catalog.similar(route.route.provider, wanted)
        : await this.catalog.candidates(route.route.provider, wanted)
      const picker = this.staleSearch(open.routeKey, search) ? null : this.getSnapshot().picker
      if (picker === null) return
      this.patch({ picker: { ...picker, searching: false, candidates, error: null } })
    } catch (error: unknown) {
      const picker = this.staleSearch(open.routeKey, search) ? null : this.getSnapshot().picker
      if (picker === null) return
      // A catalog that cannot be read leaves the values in place rather than an
      // empty picker: the model is still editable, just without its entry.
      this.patch({ picker: { ...picker, searching: false, candidates: [], error: messageOf(error) } })
    }
  }

  /**
   * Ask the open picker's route which models its own endpoint serves.
   *
   * The question is answered on the Host, not here: the adapter either knows
   * the route's models from its own catalog or interrogates the endpoint, and
   * it is the Host that holds the route's credential and can reach an address
   * a browser cannot. This panel sends the route's own endpoint facts and gets
   * back ids it may offer — nothing is read from the catalog here, and nothing
   * is written anywhere.
   *
   * A second press supersedes the first, exactly as two searches do, because
   * the reader is asking the endpoint what it serves now.
   */
  private async discover(): Promise<void> {
    const state = this.getSnapshot()
    const open = state.picker
    if (open === null) return
    const route = state.routes.find(row => row.key === open.routeKey)
    if (route === undefined) return
    const discovery = ++this.discoveries
    this.patch({ picker: { ...open, discovering: true, discovered: null, discoverError: null } })
    try {
      const response = await this.ctx.remote.llm.discoverModels(route.route.settingsNs, {
        provider: route.route.provider,
        ...route.route.baseURL === undefined ? {} : { baseURL: route.route.baseURL },
        ...route.route.api === undefined ? {} : { api: route.route.api },
      })
      const picker = this.staleDiscovery(open.routeKey, discovery) ? null : this.getSnapshot().picker
      if (picker === null) return
      this.patch({
        picker: response.ok
          ? { ...picker, discovering: false, discovered: response.value, discoverError: null }
          : { ...picker, discovering: false, discovered: null, discoverError: response.error.message },
      })
    } catch (error: unknown) {
      const picker = this.staleDiscovery(open.routeKey, discovery) ? null : this.getSnapshot().picker
      if (picker === null) return
      this.patch({ picker: { ...picker, discovering: false, discovered: null, discoverError: messageOf(error) } })
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
   * The entry the values were taken from is filed as what the new model follows,
   * exactly as an edit files one, and for the same reason: the binding decides
   * what the row is compared against. A gateway id the catalog cannot reach by
   * itself is compared against that entry from the moment it exists, instead of
   * reporting that the catalog has nothing for it.
   *
   * @param entry - the values to write.
   * @param binding - the catalog entry the values came from, or `undefined` when the catalog answered nothing.
   */
  private async append(entry: NewModelEntry, binding: EntryBinding | undefined): Promise<void> {
    const state = this.getSnapshot()
    const picker = state.picker
    if (picker === null || picker.modelKey !== null) return
    const route = state.routes.find(row => row.key === picker.routeKey)
    if (route === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ picker: null, notice: { kind: 'readonly' } })
      return
    }
    if (newModelProblem(route.route, entry) !== undefined) return
    // Filed before the write, like an edit's, so the reload the write settles
    // with is the read that shows the new row following that entry. A refused
    // write leaves the choice filed for the id it names, which nothing reads
    // until a model carrying that id is configured.
    writeBinding(this.host, bindingKey(route.key, entry.id.trim()), binding)
    await this.write(
      route.route,
      addModelOps(route.route, entry),
      { picker: null, notice: { kind: 'added', id: entry.id.trim() } },
    )
  }

  /**
   * Write one edited model back, against the entry source it should follow.
   *
   * The binding is filed first and answers nothing by itself: it decides what the
   * panel compares the model against, while the values come from the edit. A
   * reader who repointed the model at another entry and changed no values writes
   * nothing at all, and the panel reloads to show the new comparison either way.
   *
   * @param edited - the values the entry should end up holding.
   * @param binding - the catalog entry to pin, or `undefined` to follow the id again.
   */
  private async save(edited: EditedModel, binding: EntryBinding | undefined): Promise<void> {
    const state = this.getSnapshot()
    const picker = state.picker
    if (picker === null || picker.modelKey === null) return
    const route = state.routes.find(row => row.key === picker.routeKey)
    const row = route?.models.find(model => model.key === picker.modelKey)
    if (route === undefined || row === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ picker: null, notice: { kind: 'readonly' } })
      return
    }
    writeBinding(this.host, bindingKey(route.key, row.model.id), binding)
    const ops = editOps(route.route, row.model, edited)
    if (ops.length === 0) {
      this.patch({ picker: null })
      await this.load(false)
      return
    }
    await this.write(route.route, ops, { picker: null, notice: { kind: 'saved' } })
  }

  /**
   * Remove one model from a route's namespace.
   *
   * The reader confirms this in the page; the panel's own rules still apply, so
   * an adapter preset and a read-only deployment refuse it as firmly as they
   * refuse every other write. The entry binding goes with the model it described
   * rather than lingering as hidden state for an id the route no longer stores.
   *
   * @param routeKey - the route the model belongs to.
   * @param modelKey - the model being removed.
   */
  private async remove(routeKey: string, modelKey: string): Promise<void> {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    const row = route?.models.find(model => model.key === modelKey)
    if (route === undefined || row === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    writeBinding(this.host, bindingKey(route.key, row.model.id), undefined)
    await this.write(route.route, removeModelOps(route.route, row.model), {
      picker: null,
      notice: { kind: 'removed', id: row.model.id },
    })
  }

  /**
   * Run one settings write, report what it did, and reload afterwards so the
   * panel shows what the deployment now stores.
   *
   * The write's own outcome is a fact even when the Host broadcast it and a
   * re-read took over underneath: the read counter would drop this settlement
   * and leave the picker open over a model that has already changed.
   *
   * @param route - the route whose namespace is being written.
   * @param ops - the edits to make.
   * @param done - what to publish once the namespace accepted them.
   */
  private async write(route: ConfiguredRoute, ops: SettingsPathOpView[], done: Partial<ModelsDevState>): Promise<void> {
    this.patch({ writing: [route.settingsNs], notice: null })
    try {
      const response = await this.ctx.remote.settings.mutate(route.settingsNs, ops, route.revision)
      if (this.unloaded) return
      if (!response.ok) {
        this.patch({
          notice: response.error.code === 'settings/conflict'
            ? { kind: 'conflict' }
            : { kind: 'refused', message: response.error.message },
        })
        return
      }
      this.patch(done)
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
   *
   * The catalog read is the one whose failure the page survives: it is this
   * browser's own network reach, and a deployment whose configuration is
   * readable is still worth showing while it cannot be compared — the rows
   * render as unmatched rather than disappearing behind a whole-page error.
   * A configuration read that fails is fatal, because every row the panel
   * renders comes from it.
   *
   * @param force - whether to read the catalog again instead of its held copy.
   */
  private async load(force: boolean): Promise<void> {
    const generation = ++this.generation
    this.patch(force ? { refreshing: true } : { status: 'loading' })
    try {
      const [directory, described] = await Promise.all([this.directory(), this.namespaces()])
      const routes = readRoutes(directory, described)
      const bindings = readBindings(this.host)
      // One lookup per configured model, each carrying the entry this browser
      // pinned for it, so a binding never costs a second Remote round. A route
      // key plus a model id names the model, so the same key the binding is
      // filed under is the one this read has to rebuild.
      const lookups: ModelsDevLookup[] = routes.flatMap(route => route.models.map((model) => {
        const binding = bindings.get(bindingKey(routeKeyOf(route), model.id))
        return {
          provider: route.provider,
          modelId: model.id,
          ...binding === undefined ? {} : { binding },
        }
      }))
      // A deployment with no configured model has nothing to compare, so its
      // catalog is left unread; an explicit refresh reads it regardless.
      const compare = force || lookups.length > 0
      const [catalogAnswer, matches] = await Promise.all([
        compare ? this.catalog.view(force).then(
          catalog => ({ catalog, catalogError: null }),
          catalogFailure,
        ) : Promise.resolve({ catalog: null, catalogError: null }),
        compare ? this.catalog.match(lookups).catch(() => [] as ModelsDevMatch[]) : Promise.resolve([] as ModelsDevMatch[]),
      ])
      if (this.stale(generation)) return
      const answers = answersBy(matches)
      this.patch({
        status: 'ready',
        error: null,
        writable: described.writable,
        refreshing: false,
        catalog: catalogAnswer.catalog,
        catalogError: catalogAnswer.catalogError,
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
      // A surviving catalog failure has already been turned into a value above;
      // what reaches this branch is a configuration read, which the page cannot
      // render without.
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
   * newer keystroke replaced it or because its picker is no longer open.
   */
  private staleSearch(routeKey: string, search: number): boolean {
    if (this.unloaded || search !== this.searches) return true
    const picker = this.getSnapshot().picker
    return picker === null || picker.routeKey !== routeKey
  }

  /**
   * Whether one endpoint interrogation settled too late to publish, either
   * because a newer press replaced it or because its dialog is no longer open.
   */
  private staleDiscovery(routeKey: string, discovery: number): boolean {
    if (this.unloaded || discovery !== this.discoveries) return true
    const picker = this.getSnapshot().picker
    return picker === null || picker.routeKey !== routeKey
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
