/**
 * Panel state for the models.dev page: the configured routes joined with what
 * the catalog says about them, the writes that commit the editor or adopt the
 * published values, and the two dialogs that add a model or repoint one at a
 * catalog entry. The Host Remote reads, the settings writes, and the
 * browser-local entry bindings are bound here, so a component receives plain
 * data and callbacks only.
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
import { applyOps, compareModel, removeModelOps, type FieldDifference } from './comparison.ts'
import { readRoutes, type ConfiguredModel, type ConfiguredRoute } from './configured.ts'
import { draftDiffers, draftOps, draftProblem, type DraftProblem, type ModelDraft } from './draft.ts'

export type { NewModelEntry, NewModelProblem, NewModelTemplate } from './add-model.ts'
export type { EntryBinding } from './bindings.ts'
export type { ModelDraft, DraftProblem } from './draft.ts'

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
  /** The open card's edits reached the namespace. */
  | { readonly kind: 'applied' }
  /** Every differing value of every writable route reached its namespace. */
  | { readonly kind: 'adopted' }
  /** One new model reached the namespace. */
  | { readonly kind: 'added'; readonly id: string }
  /** One model was removed from the namespace. */
  | { readonly kind: 'removed'; readonly id: string }
  /** One model was repointed at another catalog entry. */
  | { readonly kind: 'bound' }
  /** A draft broke a rule the route's adapter enforces, so nothing was written. */
  | { readonly kind: 'invalid'; readonly problem: DraftProblem }
  /** Another writer changed the namespace since the panel read it. */
  | { readonly kind: 'conflict' }
  /** The namespace refused the edit and said why. */
  | { readonly kind: 'refused'; readonly message: string }
  /** The profile does not accept settings writes. */
  | { readonly kind: 'readonly' }

/**
 * The dialog that is open, if any.
 *
 * Both dialogs ask the same questions — which catalog entry answers to this
 * model id, and which models the route's own endpoint serves — so they share
 * one state and one set of searches; `mode` decides which one is committed.
 */
export interface EditorState {
  /** Whether the dialog adds a model to the route or repoints one inside it. */
  readonly mode: 'add' | 'entry'
  /** Route the dialog belongs to. */
  readonly routeKey: string
  /** The model being repointed, or `null` when a model is being added. */
  readonly modelKey: string | null
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

/** One route's staged edits, as the editor commits them. */
export interface RouteEdit {
  /** The model the draft was opened from. */
  readonly modelKey: string
  /** The staged values. */
  readonly draft: ModelDraft
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
  /** The open dialog, or `null` when none is. */
  readonly editor: EditorState | null
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
  /** Adopt every differing value of every writable route, one settings write per namespace. */
  readonly adoptAll: () => void
  /** Commit one route's staged edits as a single write. */
  readonly saveRoute: (routeKey: string, edits: readonly RouteEdit[]) => void
  /** Open the add-model dialog for a route. */
  readonly openAdd: (routeKey: string) => void
  /** Open the dialog that picks which catalog entry one model follows. */
  readonly openEntry: (routeKey: string, modelKey: string) => void
  /** Ask the catalog about one model id for the open dialog. */
  readonly searchModel: (modelId: string, fuzzy: boolean) => void
  /** Ask the open dialog's route which models its own endpoint serves. */
  readonly discoverModels: () => void
  /** Append a new model entry to the route the open dialog belongs to, following the entry it was filled from. */
  readonly addModel: (entry: NewModelEntry, binding: EntryBinding | undefined) => void
  /** Pin the catalog entry the open dialog's model follows. */
  readonly bindEntry: (binding: EntryBinding | null) => void
  /** Remove one model from a route's namespace. */
  readonly removeModel: (routeKey: string, modelKey: string) => void
  /** Close the open dialog without writing. */
  readonly cancelEditor: () => void
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
 * @param matches - the answers one read returned.
 * @returns the answers, keyed for lookup.
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
 * Join the configured routes with the models.dev catalog and commit what it
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
      editor: null,
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
      adoptAll: () => { void this.adopt(this.planAll()) },
      saveRoute: (routeKey, edits) => { void this.save(routeKey, edits) },
      openAdd: (routeKey) => { this.open('add', routeKey, null) },
      openEntry: (routeKey, modelKey) => { this.open('entry', routeKey, modelKey) },
      searchModel: (modelId, fuzzy) => { void this.search(modelId, fuzzy) },
      discoverModels: () => { void this.discover() },
      addModel: (entry, binding) => { void this.append(entry, binding) },
      bindEntry: (binding) => { this.bind(binding) },
      removeModel: (routeKey, modelKey) => { void this.remove(routeKey, modelKey) },
      cancelEditor: () => { this.patch({ editor: null }) },
    }
  }

  /**
   * Open one of the two dialogs for a route, or for one model inside it.
   *
   * An adapter preset brings its own profile, so the panel compares it and never
   * writes it; that holds for a model added to it as much as for a corrected
   * value on one it already carries. The dialogs are the only place either is
   * offered, so refusing it here refuses both at once.
   *
   * @param mode - whether the dialog adds a model or repoints one.
   * @param routeKey - the route the model belongs to, or is being added to.
   * @param modelKey - the model being repointed, or `null` to add one.
   */
  private open(mode: EditorState['mode'], routeKey: string, modelKey: string | null): void {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined || route.route.preset) return
    if (modelKey !== null && !route.models.some(row => row.key === modelKey)) return
    if (!state.writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    const row = modelKey === null ? undefined : route.models.find(row => row.key === modelKey)
    this.patch({
      editor: {
        mode,
        routeKey,
        modelKey,
        // The dialog opens on the id the model already has, so a repoint starts
        // from the catalog answer the row was compared against.
        modelId: row?.model.id ?? '',
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
   * Ask the catalog which entries answer to the model id the open dialog holds.
   *
   * The dialog asks on every keystroke, so a search supersedes the one before it
   * and the one before that is dropped rather than published over a longer id.
   * The catalog read behind the answer is shared and cached by the service, so a
   * keystroke that arrives mid-read waits on it instead of starting another.
   *
   * @param modelId - the id as typed, untrimmed.
   * @param fuzzy - whether to search for ids that merely came close.
   */
  private async search(modelId: string, fuzzy: boolean): Promise<void> {
    const state = this.getSnapshot()
    const open = state.editor
    if (open === null) return
    const route = state.routes.find(row => row.key === open.routeKey)
    if (route === undefined) return
    const wanted = modelId.trim()
    if (wanted === '') {
      this.patch({ editor: { ...open, modelId, fuzzy, searching: false, candidates: [], error: null } })
      return
    }
    const search = ++this.searches
    this.patch({ editor: { ...open, modelId, fuzzy, searching: true, candidates: [], error: null } })
    try {
      const candidates = fuzzy
        ? await this.catalog.similar(route.route.provider, wanted)
        : await this.catalog.candidates(route.route.provider, wanted)
      const editor = this.staleSearch(open.routeKey, search) ? null : this.getSnapshot().editor
      if (editor === null) return
      this.patch({ editor: { ...editor, searching: false, candidates, error: null } })
    } catch (error: unknown) {
      const editor = this.staleSearch(open.routeKey, search) ? null : this.getSnapshot().editor
      if (editor === null) return
      // A catalog that cannot be read leaves the values in place rather than an
      // empty dialog: the model is still editable, just without its entry.
      this.patch({ editor: { ...editor, searching: false, candidates: [], error: messageOf(error) } })
    }
  }

  /**
   * Ask the open dialog's route which models its own endpoint serves.
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
    const open = state.editor
    if (open === null) return
    const route = state.routes.find(row => row.key === open.routeKey)
    if (route === undefined) return
    const discovery = ++this.discoveries
    this.patch({ editor: { ...open, discovering: true, discovered: null, discoverError: null } })
    try {
      const response = await this.ctx.remote.llm.discoverModels(route.route.settingsNs, {
        provider: route.route.provider,
        ...route.route.baseURL === undefined ? {} : { baseURL: route.route.baseURL },
        ...route.route.api === undefined ? {} : { api: route.route.api },
      })
      const editor = this.staleDiscovery(open.routeKey, discovery) ? null : this.getSnapshot().editor
      if (editor === null) return
      this.patch({
        editor: response.ok
          ? { ...editor, discovering: false, discovered: response.value, discoverError: null }
          : { ...editor, discovering: false, discovered: null, discoverError: response.error.message },
      })
    } catch (error: unknown) {
      const editor = this.staleDiscovery(open.routeKey, discovery) ? null : this.getSnapshot().editor
      if (editor === null) return
      this.patch({ editor: { ...editor, discovering: false, discovered: null, discoverError: messageOf(error) } })
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
   * exactly as a repoint files one, and for the same reason: the binding decides
   * what the row is compared against. A gateway id the catalog cannot reach by
   * itself is compared against that entry from the moment it exists, instead of
   * reporting that the catalog has nothing for it.
   *
   * @param entry - the values to write.
   * @param binding - the catalog entry the values came from, or `undefined` when the catalog answered nothing.
   */
  private async append(entry: NewModelEntry, binding: EntryBinding | undefined): Promise<void> {
    const state = this.getSnapshot()
    const editor = state.editor
    if (editor === null || editor.mode !== 'add') return
    const route = state.routes.find(row => row.key === editor.routeKey)
    if (route === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ editor: null, notice: { kind: 'readonly' } })
      return
    }
    if (newModelProblem(route.route, entry) !== undefined) return
    // Filed before the write, like a repoint's, so the reload the write settles
    // with is the read that shows the new row following that entry. A refused
    // write leaves the choice filed for the id it names, which nothing reads
    // until a model carrying that id is configured.
    writeBinding(this.host, bindingKey(route.key, entry.id.trim()), binding)
    await this.write(
      route.route,
      addModelOps(route.route, entry),
      { editor: null, notice: { kind: 'added', id: entry.id.trim() } },
    )
  }

  /**
   * Commit one route's staged edits.
   *
   * Every draft is checked against the route's own rules before anything is
   * written, so a refusal names a rule rather than arriving as a schema error
   * over a half-written card. A model whose id the edit changed takes its
   * browser-local entry binding with it: the binding is filed under the id the
   * model is compared as, and leaving it under the old id would silently
   * unpin a model that only had a typo corrected.
   *
   * @param routeKey - the route whose card committed.
   * @param edits - the drafts the card holds, including ones that changed nothing.
   */
  private async save(routeKey: string, edits: readonly RouteEdit[]): Promise<void> {
    const state = this.getSnapshot()
    const route = state.routes.find(row => row.key === routeKey)
    if (route === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ notice: { kind: 'readonly' } })
      return
    }
    const ops: SettingsPathOpView[] = []
    const renamed: { from: ConfiguredModel; to: string }[] = []
    for (const edit of edits) {
      const row = route.models.find(model => model.key === edit.modelKey)
      if (row === undefined) continue
      // A row whose staged values match what it stores is not this write's
      // business, and checking it would let an untouched draft the adapter
      // would refuse block the rows that did change.
      if (!draftDiffers(edit.draft, row.model)) continue
      const problem = draftProblem(route.route, row.model, edit.draft)
      if (problem !== undefined) {
        this.patch({ notice: { kind: 'invalid', problem } })
        return
      }
      ops.push(...draftOps(route.route, row.model, edit.draft))
      const id = edit.draft.id.trim()
      if (id !== row.model.id) renamed.push({ from: row.model, to: id })
    }
    for (const { from, to } of renamed) this.refile(route.key, from.id, to)
    if (ops.length === 0) {
      await this.load(false)
      return
    }
    await this.write(route.route, ops, { notice: { kind: 'applied' } })
  }

  /**
   * Move one model's browser-local entry binding to the id it now stores.
   * @param routeKey - the route's panel key.
   * @param from - the id the binding was filed under.
   * @param to - the id the model now carries.
   */
  private refile(routeKey: string, from: string, to: string): void {
    const bindings = readBindings(this.host)
    const binding = bindings.get(bindingKey(routeKey, from))
    if (binding === undefined) return
    writeBinding(this.host, bindingKey(routeKey, from), undefined)
    writeBinding(this.host, bindingKey(routeKey, to), binding)
  }

  /**
   * Pin the catalog entry the open dialog's model follows.
   *
   * The binding decides what the model is compared against and never what is
   * written, so this is not a settings write: it is filed for this browser and
   * followed by the re-read that shows the new comparison. A model that already
   * diverged from the newly pinned entry keeps its stored values — adopting
   * them is the card's own edit, where the reader can see what changes.
   *
   * @param binding - the entry to pin, or `null` to follow the id again.
   */
  private bind(binding: EntryBinding | null): void {
    const state = this.getSnapshot()
    const editor = state.editor
    if (editor === null || editor.mode !== 'entry' || editor.modelKey === null) return
    const route = state.routes.find(row => row.key === editor.routeKey)
    const row = route?.models.find(model => model.key === editor.modelKey)
    if (route === undefined || row === undefined || route.route.preset) return
    if (!state.writable) {
      this.patch({ editor: null, notice: { kind: 'readonly' } })
      return
    }
    writeBinding(this.host, bindingKey(route.key, row.model.id), binding ?? undefined)
    this.patch({ editor: null, notice: { kind: 'bound' } })
    void this.load(false)
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
      editor: null,
      notice: { kind: 'removed', id: row.model.id },
    })
  }

  /**
   * Run one settings write, report what it did, and reload afterwards so the
   * panel shows what the deployment now stores.
   *
   * The write's own outcome is a fact even when the Host broadcast it and a
   * re-read took over underneath: the read counter would drop this settlement
   * and leave a dialog open over a model that has already changed.
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
   * Group every differing model of every writable route into one write per
   * namespace.
   *
   * Two routes can share a namespace, and a namespace carries one revision, so
   * a namespace's rows travel together in a single write that the revision
   * still guards. A preset route contributes nothing: the adapter ships that
   * route's profile, so its differences are shown and never written.
   *
   * @returns the writes to run, in route order.
   */
  private planAll(): WriteGroup[] {
    const groups = new Map<string, WriteGroup>()
    for (const route of this.getSnapshot().routes) {
      if (route.route.preset) continue
      const ops = route.models.flatMap(row => applyOps(route.route, row.model, row.differences))
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
  private async adopt(groups: readonly WriteGroup[]): Promise<void> {
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
      this.patch({ notice: { kind: 'adopted' } })
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
   * newer keystroke replaced it or because its dialog is no longer open.
   */
  private staleSearch(routeKey: string, search: number): boolean {
    if (this.unloaded || search !== this.searches) return true
    const editor = this.getSnapshot().editor
    return editor === null || editor.routeKey !== routeKey
  }

  /**
   * Whether one endpoint interrogation settled too late to publish, either
   * because a newer press replaced it or because its dialog is no longer open.
   */
  private staleDiscovery(routeKey: string, discovery: number): boolean {
    if (this.unloaded || discovery !== this.discoveries) return true
    const editor = this.getSnapshot().editor
    return editor === null || editor.routeKey !== routeKey
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
