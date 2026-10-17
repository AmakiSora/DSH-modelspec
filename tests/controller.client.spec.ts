/**
 * The panel's controller: one read covering the directory, the settings
 * namespaces, and the catalog; the comparison it publishes; the writes that
 * commit a card's staged edits or adopt every difference; the two dialogs; and
 * the settlements that arrive too late to matter.
 */

import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  LlmConfigurableProvider, LlmDiscoveredModel, LlmModelDiscoveryRequest, SettingsDescribeValue, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsDevCatalog, ModelsDevError } from '../src/client/catalog-service.ts'
import { bindingHost, bindingKey, readBindings, writeBinding } from '../src/client/bindings.ts'
import type { ModelsDevCandidate, ModelsDevCatalogView, ModelsDevLookup, ModelsDevMatch, ModelsDevSimilar } from '../src/client/types.ts'
import { ModelsDevController, type ModelRowView } from '../src/client/store.ts'
import type { NewModelEntry } from '../src/client/add-model.ts'
import { draftOf } from '../src/client/draft.ts'

/** One redacted namespace view. */
function view(ns: string, value: unknown, revision = 1): SettingsDescribeValue['namespaces'][number] {
  return { ns, autoGenerate: true, schema: {}, value: value as never, applies: 'live', secrets: [], revision }
}

/** The describe() envelope the panel reads. */
function described(namespaces: SettingsDescribeValue['namespaces'], writable = true): SettingsDescribeValue {
  return { writable, hasDocument: true, namespaces }
}

/** One directory entry for a route the deployment declared. */
function entry(overrides: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider {
  return { provider: 'acme', displayName: 'Acme', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'acme'], declared: true, ...overrides }
}

/** One catalog answer. */
function matchFor(provider: string, modelId: string, published?: Record<string, unknown>): ModelsDevMatch {
  return {
    provider,
    modelId,
    routeProviderKey: provider,
    providerKey: provider,
    strategy: 'exact',
    model: {
      providerId: provider,
      id: modelId,
      name: modelId,
      inputModalities: ['text'],
      reasoning: false,
      toolCall: true,
      structuredOutput: false,
      temperature: true,
      ...published,
    },
  }
}

/** The catalog facts a successful read publishes. */
const CATALOG: ModelsDevCatalogView = {
  source: 'https://openrouter.ai/api/v1/models',
  fetchedAt: 4242,
  providers: [{ id: 'acme', name: 'Acme', modelCount: 2 }],
  modelCount: 2,
  skippedCount: 0,
}

/** What one scripted read answers with; every field is replaceable per call. */
interface Script {
  directory: LlmConfigurableProvider[]
  described: SettingsDescribeValue
  matches: ModelsDevMatch[]
  catalog: ModelsDevCatalogView
  /** Entries one candidate search answers with. */
  candidates?: ModelsDevCandidate[]
  /** Entries one fuzzy search answers with. */
  similar?: ModelsDevSimilar[]
  /** Reject one candidate search instead of answering it. */
  candidatesFailure?: Error
  /** Models one endpoint interrogation answers with. */
  discovered?: LlmDiscoveredModel[]
  /** Answers for successive interrogations, taken before `discovered`. */
  discoveryQueue?: LlmDiscoveredModel[][]
  /** Refuse one endpoint interrogation instead of answering it. */
  discoveryRefusal?: RemoteError
  /** Reject one endpoint interrogation instead of answering it. */
  discoveryFailure?: Error
  /** Answer the next `settings.mutate` with instead of accepting it. */
  mutate?: () => { ok: true; value: SettingsDescribeValue['namespaces'][number] } | { ok: false; error: RemoteError }
  /** Run inside `settings.mutate`, standing in for the Host's own broadcast. */
  broadcast?: () => void
  /** Refuse the provider directory instead of answering it. */
  directoryRefusal?: RemoteError
  /** Reject the provider directory instead of answering it. */
  directoryFailure?: Error
  /** Reject the catalog read instead of answering it. */
  catalogFailure?: Error
}

/** A panel over one scripted set of Remote faces, with the script still mutable. */
interface Bench {
  readonly panel: ModelsDevController
  readonly script: Script
  readonly writes: SettingsPathOpView[]
  readonly reads: { catalog: number; refresh: number; match: number }
  readonly searches: { provider: string; modelId: string }[]
  readonly interrogations: { settingsNs: string; request: LlmModelDiscoveryRequest }[]
}

/** Build a panel over the given script. */
function bench(script: Partial<Script> = {}): Bench {
  const live: Script = {
    directory: [],
    described: described([]),
    matches: [],
    catalog: CATALOG,
    ...script,
  }
  const writes: SettingsPathOpView[] = []
  const reads = { catalog: 0, refresh: 0, match: 0 }
  const searches: { provider: string; modelId: string }[] = []
  const interrogations: { settingsNs: string; request: LlmModelDiscoveryRequest }[] = []
  const remote = {
    llm: {
      listConfigurableProviders: () => {
        if (live.directoryFailure !== undefined) return Promise.reject(live.directoryFailure)
        return live.directoryRefusal === undefined
          ? Promise.resolve({ ok: true, value: live.directory })
          : Promise.resolve({ ok: false, error: live.directoryRefusal })
      },
      discoverModels: (settingsNs: string, request: LlmModelDiscoveryRequest) => {
        interrogations.push({ settingsNs, request })
        if (live.discoveryFailure !== undefined) return Promise.reject(live.discoveryFailure)
        return live.discoveryRefusal === undefined
          ? Promise.resolve({ ok: true, value: live.discoveryQueue?.shift() ?? live.discovered ?? [] })
          : Promise.resolve({ ok: false, error: live.discoveryRefusal })
      },
    },
    settings: {
      describe: () => Promise.resolve({ ok: true, value: live.described }),
      mutate: (ns: string, ops: SettingsPathOpView[], revision: number) => {
        writes.push(...ops)
        live.broadcast?.()
        return Promise.resolve(live.mutate?.() ?? { ok: true, value: view(ns, {}, revision + 1) })
      },
    },
  }
  const catalog = {
    source: live.catalog.source,
    view: (force?: boolean) => {
      reads.catalog += 1
      if (force === true) reads.refresh += 1
      return live.catalogFailure === undefined
        ? Promise.resolve(live.catalog)
        : Promise.reject(live.catalogFailure)
    },
    match: (lookups: readonly ModelsDevLookup[]) => {
      reads.match += 1
      return Promise.resolve(lookups.map((lookup) => {
        const scripted = live.matches.find(answer => answer.provider === lookup.provider && answer.modelId === lookup.modelId)
        // A lookup carrying a binding is answered by that entry, exactly as the
        // real service answers it; the scripted entry still supplies its values.
        if (lookup.binding !== undefined && scripted?.model !== undefined) {
          return {
            ...lookup,
            routeProviderKey: lookup.binding.providerId,
            providerKey: lookup.binding.providerId,
            strategy: 'bound' as const,
            model: { ...scripted.model, providerId: lookup.binding.providerId, id: lookup.binding.modelId },
          }
        }
        return scripted ?? { ...lookup, strategy: 'none' as const }
      }))
    },
    candidates: (provider: string, modelId: string) => {
      searches.push({ provider, modelId })
      return live.candidatesFailure === undefined
        ? Promise.resolve(live.candidates ?? [])
        : Promise.reject(live.candidatesFailure)
    },
    similar: (provider: string, modelId: string) => {
      searches.push({ provider, modelId })
      return live.candidatesFailure === undefined
        ? Promise.resolve(live.similar ?? [])
        : Promise.reject(live.candidatesFailure)
    },
  } as unknown as ModelsDevCatalog
  return { panel: new ModelsDevController({ remote } as never, catalog), script: live, writes, reads, searches, interrogations }
}

/** One ready panel: one route, one model, a published context and modalities that differ. */
function readyBench(writable = true): Bench {
  const seat = bench({
    directory: [entry()],
    described: described(
      [view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', contextWindow: 1024, input: ['text'] }] } } })],
      writable,
    ),
    matches: [matchFor('acme', 'acme-1', { contextWindow: 1048576, inputModalities: ['text', 'image'] })],
  })
  seat.panel.inject().ensure()
  return seat
}

/** Let every queued promise and its follow-ups settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

/** The one row a bench publishes under a route key. */
function rowOf(seat: Bench, routeKey = 'llm-pi-ai/acme', index = 0): ModelRowView {
  const row = seat.panel.getSnapshot().routes.find(route => route.key === routeKey)?.models[index]
  if (row === undefined) throw new Error(`no row ${routeKey}/${String(index)}`)
  return row
}

/** One staged edit of the row's own values. */
function edited(row: ModelRowView, change: Partial<ReturnType<typeof draftOf>> = {}): { modelKey: string; draft: ReturnType<typeof draftOf> } {
  return { modelKey: row.key, draft: { ...draftOf(row.model), ...change } }
}

describe('panel controller reads', () => {
  it('starts idle with nothing published', () => {
    expect(bench().panel.getSnapshot()).toMatchObject({ status: 'idle', routes: [], catalog: null, writable: false })
  })

  it('publishes one route per directory entry with the catalog facts and the matches', async () => {
    const seat = readyBench()
    await settle()
    expect(seat.panel.getSnapshot()).toMatchObject({ status: 'ready', writable: true, catalog: CATALOG })
    expect(rowOf(seat)).toMatchObject({
      key: 'llm-pi-ai/acme/0',
      differences: [
        { field: 'contextWindow', configured: 1024, published: 1048576 },
        { field: 'input', configured: ['text'], published: ['text', 'image'] },
      ],
    })
  })

  it('leaves out every dormant catalog route and reads no catalog at all', async () => {
    const { panel, reads } = bench({
      directory: [entry(), entry({ provider: 'other', settingsPath: ['providers', 'other'] })],
      // Neither route resolves a profile that declares a model, so the panel has
      // nothing to compare and leaves the catalog unread.
      described: described([view('llm-pi-ai', { providers: { acme: { models: [] }, other: { models: [] } } })]),
    })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot().routes).toEqual([])
    expect(reads.catalog).toBe(0)
  })

  it('reports a model the catalog answered nothing for as unmatched', async () => {
    const seat = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
    })
    seat.panel.inject().ensure()
    await settle()
    expect(rowOf(seat)).toMatchObject({ match: { strategy: 'none' }, differences: [] })
  })

  it('surfaces a refused provider directory as one diagnostic', async () => {
    const { panel } = bench({ directoryRefusal: new RemoteError('llm/unsupported', 'no directory', {}) })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'error', error: 'no directory' })
  })

  it('surfaces a rejected read with the message it reports', async () => {
    const { panel } = bench({ directoryFailure: new Error('socket gone') })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'error', error: 'socket gone' })
  })

  it('surfaces a catalog refusal as a diagnostic beside the configured rows', async () => {
    const { panel } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
      catalogFailure: new ModelsDevError('catalog unavailable', 'https://example.test/models'),
    })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'ready', catalog: null, catalogError: 'catalog unavailable' })
    expect(panel.getSnapshot().routes).toHaveLength(1)
  })

  it('reads the catalog again only when a refresh is asked for', async () => {
    const seat = readyBench()
    await settle()
    const before = seat.reads.refresh
    seat.panel.invalidate()
    await settle()
    expect(seat.reads.refresh).toBe(before)
    seat.panel.inject().refresh()
    await settle()
    expect(seat.reads.refresh).toBe(before + 1)
  })

  it('publishes nothing from a read that settles after the controller was unloaded', async () => {
    const { panel } = bench({ directory: [entry()] })
    panel.inject().ensure()
    panel.dispose()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ routes: [], catalog: null })
  })

  it('lets the newest read publish and drops the one it superseded', async () => {
    const seat = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
      matches: [matchFor('acme', 'acme-1')],
    })
    seat.panel.inject().ensure()
    seat.panel.invalidate()
    await settle()
    expect(seat.panel.getSnapshot().routes).toHaveLength(1)
  })
})

describe('panel controller adopts every difference', () => {
  it('writes every differing value of every route, each under its own namespace', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().adoptAll()
    await settle()
    expect(seat.writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'contextWindow'], value: 1048576 },
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'input'], value: ['text', 'image'] },
    ])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'adopted' })
  })

  it('writes one namespace at a time when two routes differ', async () => {
    const { panel, writes } = bench({
      directory: [entry(), entry({ provider: 'other', settingsNs: 'llm-deepseek', settingsPath: [] })],
      described: described([
        view('llm-pi-ai', { providers: { acme: { models: [{ id: 'a', input: ['text'] }] } } }),
        view('llm-deepseek', { models: [{ id: 'b', inputModalities: ['text'] }] }),
      ]),
      matches: [matchFor('acme', 'a', { contextWindow: 1024 }), matchFor('other', 'b', { contextWindow: 2048 })],
    })
    panel.inject().ensure()
    await settle()
    panel.inject().adoptAll()
    await settle()
    expect(writes.map(op => op.path[0])).toEqual(['providers', 'models'])
  })

  it('writes nothing when nothing differs', async () => {
    const { panel, writes } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', contextWindow: 1048576, input: ['text', 'image'] }] } } })]),
      matches: [matchFor('acme', 'acme-1', { contextWindow: 1048576, inputModalities: ['text', 'image'] })],
    })
    panel.inject().ensure()
    await settle()
    panel.inject().adoptAll()
    await settle()
    expect(writes).toEqual([])
  })

  it('refuses to write into a deployment that does not accept settings writes', async () => {
    const seat = readyBench(false)
    await settle()
    seat.panel.inject().adoptAll()
    await settle()
    expect(seat.writes).toEqual([])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'readonly' })
  })

  it('writes nothing into an adapter preset route', async () => {
    const { panel, writes } = bench({
      // Exactly what llm-deepseek-api-key registers: the adapter brings this
      // route itself and answers no `declared` question about it.
      directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-api-key', settingsPath: [] }],
      described: described([view('llm-deepseek-api-key', { models: [{ id: 'deepseek-v4-pro', contextWindow: 1000000 }] })]),
      matches: [matchFor('deepseek-official', 'deepseek-v4-pro', { contextWindow: 131072 })],
    })
    panel.inject().ensure()
    await settle()
    // The comparison is still published; only the write is withheld.
    expect(panel.getSnapshot().routes[0]?.models[0]?.differences).toHaveLength(1)
    panel.inject().adoptAll()
    await settle()
    expect(writes).toEqual([])
  })

  it('releases the write lock when its own write invalidates the panel', async () => {
    const seat = readyBench()
    await settle()
    // Writing a namespace makes the Host broadcast `settings/document-updated`,
    // which invalidates the read this write is running under.
    seat.script.broadcast = () => { seat.panel.invalidate() }
    seat.panel.inject().adoptAll()
    await settle()
    expect(seat.writes).toHaveLength(2)
    expect(seat.panel.getSnapshot().writing).toEqual([])
    expect(seat.panel.getSnapshot().status).toBe('ready')
  })

  it('reports a stale revision as a conflict', async () => {
    const seat = readyBench()
    await settle()
    seat.script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/conflict', 'the namespace moved', { ns: 'llm-pi-ai', expected: 1, actual: 2 }),
    })
    seat.panel.inject().adoptAll()
    await settle()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'conflict' })
  })

  it('reports a namespace refusal with the host message', async () => {
    const seat = readyBench()
    await settle()
    seat.script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/refused', 'the schema says no', {}),
    })
    seat.panel.inject().adoptAll()
    await settle()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'refused', message: 'the schema says no' })
  })
})

describe('panel controller commits a card', () => {
  it('writes only the fields the card changed, in one write', async () => {
    const seat = readyBench()
    await settle()
    const row = rowOf(seat)
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(row, { contextWindow: '2048' })])
    await settle()
    expect(seat.writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'contextWindow'], value: 2048 },
    ])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'applied' })
  })

  it('writes nothing for a card whose staged values match what is stored', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(seat))])
    await settle()
    expect(seat.writes).toEqual([])
    expect(seat.panel.getSnapshot().status).toBe('ready')
  })

  it('hands a cleared field back to the adapter', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(seat), { contextWindow: '' })])
    await settle()
    expect(seat.writes).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'models', '0', 'contextWindow'] },
    ])
  })

  it('refiles the entry a renamed model followed under its new id', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    const routeKey = 'llm-pi-ai/acme'
    writeBinding(host, bindingKey(routeKey, 'acme-1'), { providerId: 'acme', modelId: 'acme-1' })
    seat.panel.inject().saveRoute(routeKey, [edited(rowOf(seat), { id: 'acme-renamed' })])
    await settle()
    expect(seat.writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'id'], value: 'acme-renamed' },
    ])
    expect(readBindings(host).get(bindingKey(routeKey, 'acme-1'))).toBeUndefined()
    expect(readBindings(host).get(bindingKey(routeKey, 'acme-renamed'))).toEqual({ providerId: 'acme', modelId: 'acme-1' })
    writeBinding(host, bindingKey(routeKey, 'acme-renamed'), undefined)
  })

  it('writes nothing and says so when a staged value breaks the route rule', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(seat), { contextWindow: '0' })])
    await settle()
    expect(seat.writes).toEqual([])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'invalid', problem: 'invalid-context' })
  })

  it('does not let an untouched row block the rows that did change', async () => {
    const seat = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', {
        providers: { acme: { models: [{ id: 'a', input: ['text'] }, { id: 'b', contextWindow: 0, input: ['text'] }] },
        },
      })]),
      matches: [matchFor('acme', 'a', { contextWindow: 1024 }), matchFor('acme', 'b', { contextWindow: 2048 })],
    })
    seat.panel.inject().ensure()
    await settle()
    const first = rowOf(seat, 'llm-pi-ai/acme', 0)
    const second = rowOf(seat, 'llm-pi-ai/acme', 1)
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(first, { contextWindow: '512' }), edited(second)])
    await settle()
    expect(seat.writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'contextWindow'], value: 512 },
    ])
  })

  it('refuses a read-only deployment, a preset route, and a route it never read', async () => {
    const readOnly = readyBench(false)
    await settle()
    readOnly.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(readOnly), { name: 'x' })])
    await settle()
    expect(readOnly.writes).toEqual([])
    expect(readOnly.panel.getSnapshot().notice).toEqual({ kind: 'readonly' })

    const preset = bench({
      directory: [entry({ declared: false })],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
      matches: [matchFor('acme', 'acme-1')],
    })
    preset.panel.inject().ensure()
    await settle()
    preset.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(preset), { name: 'x' })])
    preset.panel.inject().saveRoute('llm-pi-ai/missing', [])
    await settle()
    expect(preset.writes).toEqual([])
  })

  it('keeps the refusal when the namespace rejects the write', async () => {
    const seat = readyBench()
    await settle()
    seat.script.mutate = () => ({ ok: false, error: new RemoteError('settings/refused', 'nope', {}) })
    seat.panel.inject().saveRoute('llm-pi-ai/acme', [edited(rowOf(seat), { contextWindow: '2048' })])
    await settle()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'refused', message: 'nope' })
    expect(seat.panel.getSnapshot().writing).toEqual([])
  })
})

describe('panel controller adds a model', () => {
  it('opens the dialog for a route, and closes it again without writing', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    expect(seat.panel.getSnapshot().editor).toMatchObject({ mode: 'add', routeKey: 'llm-pi-ai/acme', modelKey: null, modelId: '' })
    seat.panel.inject().cancelEditor()
    expect(seat.panel.getSnapshot().editor).toBeNull()
    expect(seat.writes).toEqual([])
  })

  it('opens no dialog for an adapter preset route, or for a route it never read', async () => {
    const preset = bench({
      directory: [entry({ declared: false })],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
      matches: [matchFor('acme', 'acme-1')],
    })
    preset.panel.inject().ensure()
    await settle()
    preset.panel.inject().openAdd('llm-pi-ai/acme')
    preset.panel.inject().openAdd('llm-pi-ai/missing')
    expect(preset.panel.getSnapshot().editor).toBeNull()
  })

  it('reports a read-only deployment instead of opening a dialog that cannot be written', async () => {
    const seat = readyBench(false)
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    expect(seat.panel.getSnapshot().editor).toBeNull()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'readonly' })
  })

  it('asks the catalog about the route the dialog was opened for', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().searchModel('acme-9', false)
    await settle()
    expect(seat.searches).toEqual([{ provider: 'acme', modelId: 'acme-9' }])
    expect(seat.panel.getSnapshot().editor).toMatchObject({ modelId: 'acme-9', candidates: [] })
  })

  it('clears the candidates without searching when the id is emptied', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().searchModel('acme-9', false)
    await settle()
    seat.panel.inject().searchModel('', false)
    await settle()
    expect(seat.searches).toHaveLength(1)
    expect(seat.panel.getSnapshot().editor).toMatchObject({ modelId: '', candidates: [], searching: false })
  })

  it('publishes only the newest of two overlapping searches', async () => {
    const seat = readyBench()
    await settle()
    seat.script.candidates = [{
      providerId: 'acme',
      model: { providerId: 'acme', id: 'acme-9', name: 'Nine', inputModalities: ['text'], reasoning: false, toolCall: true, structuredOutput: false, temperature: true },
      strategy: 'exact',
    }]
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().searchModel('acme-9', false)
    seat.panel.inject().searchModel('acme-10', false)
    await settle()
    expect(seat.panel.getSnapshot().editor).toMatchObject({ modelId: 'acme-10', searching: false })
  })

  it('publishes the entries a fuzzy search answered with', async () => {
    const seat = readyBench()
    await settle()
    seat.script.similar = [{
      providerId: 'acme',
      model: { providerId: 'acme', id: 'acme-9', name: 'Nine', inputModalities: ['text'], reasoning: false, toolCall: true, structuredOutput: false, temperature: true },
      similarity: 'near',
      distance: 1,
    }]
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().searchModel('acme-90', true)
    await settle()
    expect(seat.panel.getSnapshot().editor).toMatchObject({ fuzzy: true, candidates: [{ similarity: 'near', distance: 1 }] })
  })

  it('reports a failed search without disturbing the dialog', async () => {
    const seat = readyBench()
    await settle()
    seat.script.candidatesFailure = new Error('offline')
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().searchModel('acme-9', false)
    await settle()
    expect(seat.panel.getSnapshot().editor).toMatchObject({ searching: false, candidates: [], error: 'offline' })
  })

  it('appends the entry at the first free array index and closes the dialog', async () => {
    const seat = readyBench()
    await settle()
    const entryValues: NewModelEntry = { id: 'acme-2', contextWindow: 4096, inputModalities: ['text'], modalityField: 'input' }
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().addModel(entryValues, undefined)
    await settle()
    expect(seat.writes).toEqual([
      {
        op: 'set',
        path: ['providers', 'acme', 'models', '1'],
        value: { id: 'acme-2', contextWindow: 4096, input: ['text'] },
      },
    ])
    expect(seat.panel.getSnapshot()).toMatchObject({ editor: null, notice: { kind: 'added', id: 'acme-2' } })
  })

  it('files the entry the new model was filled from as what it follows', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().addModel(
      { id: 'acme-2', inputModalities: ['text'], modalityField: 'input' },
      { providerId: 'acme', modelId: 'acme-2' },
    )
    await settle()
    expect(readBindings(host).get(bindingKey('llm-pi-ai/acme', 'acme-2'))).toEqual({ providerId: 'acme', modelId: 'acme-2' })
    writeBinding(host, bindingKey('llm-pi-ai/acme', 'acme-2'), undefined)
  })

  it('writes no draft the route would refuse', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    // The route already configures acme-1, and a duplicate id is one no adapter
    // accepts, so nothing reaches the namespace.
    seat.panel.inject().addModel({ id: 'acme-1', inputModalities: ['text'], modalityField: 'input' }, undefined)
    await settle()
    expect(seat.writes).toEqual([])
    expect(seat.panel.getSnapshot().editor?.mode).toBe('add')
  })

  it('keeps the dialog open and says so when the namespace refuses the entry', async () => {
    const seat = readyBench()
    await settle()
    seat.script.mutate = () => ({ ok: false, error: new RemoteError('settings/refused', 'nope', {}) })
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().addModel({ id: 'acme-2', inputModalities: ['text'], modalityField: 'input' }, undefined)
    await settle()
    expect(seat.panel.getSnapshot().editor?.mode).toBe('add')
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'refused', message: 'nope' })
  })

  it('asks the route which models its endpoint serves, and publishes the answer', async () => {
    const seat = readyBench()
    await settle()
    seat.script.discovered = [{ id: 'acme-3', name: 'Three', contextWindow: 4096 }]
    seat.panel.inject().openAdd('llm-pi-ai/acme')
    seat.panel.inject().discoverModels()
    await settle()
    expect(seat.interrogations).toEqual([
      { settingsNs: 'llm-pi-ai', request: { provider: 'acme' } },
    ])
    expect(seat.panel.getSnapshot().editor).toMatchObject({
      discovering: false,
      discovered: [{ id: 'acme-3' }],
      discoverError: null,
    })
  })

  it('reports an interrogation the host refused, and one that rejected', async () => {
    const refused = readyBench()
    await settle()
    refused.script.discoveryRefusal = new RemoteError('llm/unsupported', 'no listing', {})
    refused.panel.inject().openAdd('llm-pi-ai/acme')
    refused.panel.inject().discoverModels()
    await settle()
    expect(refused.panel.getSnapshot().editor).toMatchObject({ discovering: false, discovered: null, discoverError: 'no listing' })

    const rejected = readyBench()
    await settle()
    rejected.script.discoveryFailure = new Error('socket gone')
    rejected.panel.inject().openAdd('llm-pi-ai/acme')
    rejected.panel.inject().discoverModels()
    await settle()
    expect(rejected.panel.getSnapshot().editor).toMatchObject({ discovering: false, discovered: null, discoverError: 'socket gone' })
  })

  it('asks nothing while no dialog is open', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().discoverModels()
    await settle()
    expect(seat.interrogations).toEqual([])
  })
})

describe('panel controller pins the entry a model follows', () => {
  it('opens on the model it was asked about, and files the chosen entry', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    seat.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    expect(seat.panel.getSnapshot().editor).toMatchObject({
      mode: 'entry',
      routeKey: 'llm-pi-ai/acme',
      modelKey: 'llm-pi-ai/acme/0',
      modelId: 'acme-1',
    })
    seat.panel.inject().bindEntry({ providerId: 'acme', modelId: 'acme-1' })
    await settle()
    expect(readBindings(host).get(bindingKey('llm-pi-ai/acme', 'acme-1'))).toEqual({ providerId: 'acme', modelId: 'acme-1' })
    expect(seat.panel.getSnapshot()).toMatchObject({ editor: null, notice: { kind: 'bound' } })
    writeBinding(host, bindingKey('llm-pi-ai/acme', 'acme-1'), undefined)
  })

  it('returns the model to the automatic match when the choice is cleared', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    writeBinding(host, bindingKey('llm-pi-ai/acme', 'acme-1'), { providerId: 'acme', modelId: 'acme-1' })
    seat.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    seat.panel.inject().bindEntry(null)
    await settle()
    expect(readBindings(host).get(bindingKey('llm-pi-ai/acme', 'acme-1'))).toBeUndefined()
  })

  it('re-reads the comparison with the entry that was pinned', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    seat.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    seat.panel.inject().bindEntry({ providerId: 'acme', modelId: 'acme-1' })
    await settle()
    expect(rowOf(seat).match.strategy).toBe('bound')
    writeBinding(host, bindingKey('llm-pi-ai/acme', 'acme-1'), undefined)
  })

  it('refuses a preset route, a model it never read, and a read-only deployment', async () => {
    const preset = bench({
      directory: [entry({ declared: false })],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1' }] } } })]),
      matches: [matchFor('acme', 'acme-1')],
    })
    preset.panel.inject().ensure()
    await settle()
    preset.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    preset.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/9')
    expect(preset.panel.getSnapshot().editor).toBeNull()

    const readOnly = readyBench(false)
    await settle()
    readOnly.panel.inject().openEntry('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    expect(readOnly.panel.getSnapshot().editor).toBeNull()
    expect(readOnly.panel.getSnapshot().notice).toEqual({ kind: 'readonly' })
  })
})

describe('panel controller removes a model', () => {
  it('unsets the index the model holds', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().removeModel('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    await settle()
    expect(seat.writes).toEqual([{ op: 'unset', path: ['providers', 'acme', 'models', '0'] }])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'removed', id: 'acme-1' })
  })

  it('takes the entry binding with the model it described', async () => {
    const host = bindingHost()
    const seat = readyBench()
    await settle()
    writeBinding(host, bindingKey('llm-pi-ai/acme', 'acme-1'), { providerId: 'acme', modelId: 'acme-1' })
    seat.panel.inject().removeModel('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    await settle()
    expect(readBindings(host).get(bindingKey('llm-pi-ai/acme', 'acme-1'))).toBeUndefined()
  })

  it('removes the model the reader pressed, not the row order the panel read back', async () => {
    const seat = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'first' }, { id: 'second' }] } } })]),
      matches: [matchFor('acme', 'first'), matchFor('acme', 'second')],
    })
    seat.panel.inject().ensure()
    await settle()
    seat.panel.inject().removeModel('llm-pi-ai/acme', 'llm-pi-ai/acme/1')
    await settle()
    expect(seat.writes).toEqual([{ op: 'unset', path: ['providers', 'acme', 'models', '1'] }])
  })

  it('refuses a preset route, an unknown model, and a read-only deployment', async () => {
    const seat = readyBench(false)
    await settle()
    seat.panel.inject().removeModel('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    seat.panel.inject().removeModel('llm-pi-ai/acme', 'llm-pi-ai/acme/9')
    await settle()
    expect(seat.writes).toEqual([])
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'readonly' })
  })
})

describe('panel controller reports a write in flight', () => {
  it('holds the namespace in `writing` until the settlement lands', async () => {
    const seat = readyBench()
    await settle()
    seat.panel.inject().adoptAll()
    expect(seat.panel.getSnapshot().writing).toEqual(['llm-pi-ai'])
    await settle()
    expect(seat.panel.getSnapshot().writing).toEqual([])
  })
})
