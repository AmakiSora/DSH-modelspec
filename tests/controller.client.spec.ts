/**
 * The panel's controller: one read covering the directory, the settings
 * namespaces, and the catalog; the comparison it publishes; the writes that
 * adopt a selection; and the settlements that arrive too late to matter.
 */

import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { LlmConfigurableProvider, SettingsDescribeValue, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsDevCatalog, ModelsDevError } from '../src/client/catalog-service.ts'
import type { ModelsDevCandidate, ModelsDevCatalogView, ModelsDevLookup, ModelsDevMatch, ModelsDevSimilar } from '../src/client/types.ts'
import { ModelsDevController } from '../src/client/store.ts'
import type { NewModelEntry } from '../src/client/add-model.ts'

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
  source: 'https://models.dev/api.json',
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
  /** Answer the next `settings.mutate` with instead of accepting it. */
  mutate?: () => { ok: true; value: SettingsDescribeValue['namespaces'][number] } | { ok: false; error: RemoteError }
  /** Run inside `settings.mutate`, standing in for the Host's own broadcast. */
  broadcast?: () => void
  /** Refuse the provider directory instead of answering it. */
  directoryRefusal?: RemoteError
  /** Reject the provider directory instead of answering it. */
  directoryFailure?: Error
  /** Refuse the catalog read instead of answering it. */
  catalogFailure?: Error
}

/** A panel over one scripted set of Remote faces, with the script still mutable. */
interface Bench {
  readonly panel: ModelsDevController
  readonly script: Script
  readonly writes: SettingsPathOpView[]
  readonly reads: { catalog: number; refresh: number; match: number }
  readonly searches: { provider: string; modelId: string }[]
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
  const remote = {
    llm: {
      listConfigurableProviders: () => {
        if (live.directoryFailure !== undefined) return Promise.reject(live.directoryFailure)
        return live.directoryRefusal === undefined
          ? Promise.resolve({ ok: true, value: live.directory })
          : Promise.resolve({ ok: false, error: live.directoryRefusal })
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
    view: () => {
      reads.catalog += 1
      return live.catalogFailure === undefined
        ? Promise.resolve(live.catalog)
        : Promise.reject(live.catalogFailure)
    },
    match: (lookups: readonly ModelsDevLookup[]) => {
      reads.match += 1
      return Promise.resolve(live.matches.length > 0
        ? live.matches
        : lookups.map(lookup => ({ ...lookup, strategy: 'none' as const })))
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
  return { panel: new ModelsDevController({ remote } as never, catalog), script: live, writes, reads, searches }
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

describe('panel controller reads', () => {
  it('starts idle with nothing published', () => {
    expect(bench().panel.getSnapshot()).toMatchObject({ status: 'idle', routes: [], catalog: null, writable: false })
  })

  it('publishes one route per directory entry with the catalog facts and the matches', async () => {
    const { panel } = readyBench()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'ready', writable: true, catalog: CATALOG })
    const row = panel.getSnapshot().routes[0]?.models[0]
    expect(row).toMatchObject({
      key: 'llm-pi-ai/acme/0',
      differences: [
        { field: 'contextWindow', configured: 1024, published: 1048576 },
        { field: 'input', configured: ['text'], published: ['text', 'image'] },
      ],
    })
  })

  it('leaves out every dormant catalog route and reads no catalog at all', async () => {
    const directory = Array.from({ length: 40 }, (_unused, index) =>
      entry({ provider: `route-${index}`, settingsPath: ['providers', `route-${index}`] }))
    const { panel, reads } = bench({
      directory,
      described: described([view('llm-pi-ai', { providers: { acme: { models: [] } } })]),
    })
    panel.inject().ensure()
    await settle()
    expect(reads.catalog).toBe(0)
    expect(panel.getSnapshot()).toMatchObject({ status: 'ready', routes: [], catalog: null })
  })

  it('reports a model the catalog answered nothing for as unmatched', async () => {
    const { panel } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'gone', input: ['text'] }] } } })]),
    })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot().routes[0]?.models[0]).toMatchObject({
      match: { provider: 'acme', modelId: 'gone', strategy: 'none' },
      differences: [],
    })
  })

  it('surfaces a refused provider directory as one diagnostic', async () => {
    const { panel } = bench({
      directoryRefusal: new RemoteError('gateway/internal', 'the adapter directory is absent', {}),
    })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'error', error: 'the adapter directory is absent' })
  })

  it('surfaces a rejected read with the message it reports', async () => {
    const { panel } = bench({ directoryFailure: new Error('the transport closed') })
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'error', error: 'the transport closed' })
  })

  it('surfaces a catalog refusal with the message the read reported', async () => {
    const seat = bench()
    seat.panel.dispose()
    const failing = new ModelsDevController({
      remote: {
        llm: { listConfigurableProviders: () => Promise.resolve({ ok: true, value: [] }) },
        settings: {
          describe: () => Promise.reject(new ModelsDevError('the server answered HTTP 503', CATALOG.source)),
          mutate: () => Promise.resolve({ ok: true, value: {} }),
        },
      },
    } as never, new ModelsDevCatalog())
    failing.inject().ensure()
    await settle()
    expect(failing.getSnapshot()).toMatchObject({ status: 'error', error: 'the server answered HTTP 503' })
  })

  it('reads the catalog again only when a refresh is asked for', async () => {
    const { panel, reads } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'a', input: ['text'] }] } } })]),
    })
    panel.inject().ensure()
    await settle()
    expect(reads).toEqual({ catalog: 1, refresh: 0, match: 1 })
    panel.inject().refresh()
    await settle()
    expect(reads).toEqual({ catalog: 2, refresh: 0, match: 2 })
  })

  it('re-reads the configuration without re-reading the catalog when it is invalidated', async () => {
    const seat = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'a', input: ['text'] }] } } })]),
    })
    seat.panel.inject().ensure()
    await settle()
    seat.panel.invalidate()
    await settle()
    expect(seat.reads.catalog).toBe(2)
    expect(seat.reads.refresh).toBe(0)
  })

  it('ignores an invalidation after the controller was unloaded', async () => {
    const { panel, reads } = bench()
    panel.dispose()
    panel.invalidate()
    await settle()
    expect(reads.catalog).toBe(0)
    expect(panel.getSnapshot().status).toBe('idle')
  })

  it('drops a read that settles after the controller was unloaded', async () => {
    const { panel } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [] } } })]),
    })
    panel.inject().ensure()
    panel.dispose()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'loading', routes: [] })
  })

  it('lets the newest read publish and drops the one it superseded', async () => {
    const { panel } = bench()
    panel.inject().refresh()
    panel.inject().ensure()
    await settle()
    expect(panel.getSnapshot()).toMatchObject({ status: 'ready', refreshing: false })
  })
})

describe('panel controller writes', () => {
  it('writes one selected model and reloads afterwards', async () => {
    const { panel, writes } = readyBench()
    await settle()
    panel.inject().applyModel('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    await settle()
    expect(writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'contextWindow'], value: 1048576 },
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'input'], value: ['text', 'image'] },
    ])
    expect(panel.getSnapshot().notice).toEqual({ kind: 'applied' })
  })

  it('writes nothing when the selection has no difference to adopt', async () => {
    const { panel, writes, script } = bench({
      directory: [entry()],
      described: described([view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', contextWindow: 1048576, input: ['text', 'image'] }] } } })]),
      matches: [matchFor('acme', 'acme-1', { contextWindow: 1048576, inputModalities: ['text', 'image'] })],
    })
    panel.inject().ensure()
    await settle()
    panel.inject().applyAll()
    await settle()
    expect(writes).toEqual([])
    expect(script.matches).toHaveLength(1)
  })

  it('writes every route that differs, each under its own namespace', async () => {
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
    panel.inject().applyAll()
    await settle()
    expect(writes.map(op => op.path[0])).toEqual(['providers', 'models'])
  })

  it('writes only the addressed route when one route is selected', async () => {
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
    panel.inject().applyRoute('llm-deepseek/other')
    await settle()
    expect(writes).toEqual([{ op: 'set', path: ['models', '0', 'contextWindow'], value: 2048 }])
  })

  it('refuses to write into a deployment that does not accept settings writes', async () => {
    const { panel, writes } = readyBench(false)
    await settle()
    panel.inject().applyAll()
    await settle()
    expect(writes).toEqual([])
    expect(panel.getSnapshot().notice).toEqual({ kind: 'readonly' })
  })

  it('writes nothing into an adapter preset route, whichever action names it', async () => {
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
    panel.inject().applyModel('llm-deepseek-api-key/deepseek-official', 'llm-deepseek-api-key/deepseek-official/0')
    await settle()
    panel.inject().applyRoute('llm-deepseek-api-key/deepseek-official')
    await settle()
    panel.inject().applyAll()
    await settle()
    expect(writes).toEqual([])
  })

  it('releases the write lock when its own write invalidates the panel', async () => {
    const seat = readyBench()
    await settle()
    // Writing a namespace makes the Host broadcast `settings/document-updated`,
    // which invalidates the read this selection is running under.
    seat.script.broadcast = () => { seat.panel.invalidate() }
    seat.panel.inject().applyAll()
    await settle()
    expect(seat.writes).toHaveLength(2)
    expect(seat.panel.getSnapshot().writing).toEqual([])
    expect(seat.panel.getSnapshot().status).toBe('ready')
  })

  it('reports a stale revision as a conflict', async () => {
    const { panel, script, writes } = readyBench()
    await settle()
    script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/conflict', 'the namespace moved', { ns: 'llm-pi-ai', expected: 1, actual: 2 }),
    })
    panel.inject().applyAll()
    await settle()
    expect(panel.getSnapshot().notice).toEqual({ kind: 'conflict' })
    expect(writes).toHaveLength(2)
  })

  it('reports a namespace refusal with the host message', async () => {
    const { panel, script } = readyBench()
    await settle()
    script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/rejected', 'model ids must be unique', { ns: 'llm-pi-ai' }),
    })
    panel.inject().applyAll()
    await settle()
    expect(panel.getSnapshot().notice).toEqual({ kind: 'refused', message: 'model ids must be unique' })
  })

  it('stops before the next namespace when the panel unloads mid-write', async () => {
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
    panel.inject().applyAll()
    panel.dispose()
    await settle()
    expect(writes).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '0', 'contextWindow'], value: 1024 },
    ])
  })
})

/** One candidate the catalog answers a model id with. */
function candidate(providerId: string, id: string, published: Record<string, unknown> = {}): ModelsDevCandidate {
  return {
    providerId,
    strategy: 'exact',
    model: {
      providerId,
      id,
      name: id,
      inputModalities: ['text'],
      reasoning: false,
      toolCall: true,
      structuredOutput: false,
      temperature: true,
      ...published,
    },
  }
}

/** One route holding one model, ready to accept another. */
function addBench(script: Partial<Script> = {}): Bench {
  return bench({
    directory: [entry()],
    described: described(
      [view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', contextWindow: 131072, input: ['text'] }] } } })],
    ),
    ...script,
  })
}

/** The draft one dialog would hand over for a matched entry. */
const DRAFT: NewModelEntry = {
  id: 'acme-2',
  name: 'Acme 2',
  contextWindow: 200000,
  maxTokens: 8192,
  inputModalities: ['text', 'image'],
  modalityField: 'input',
}

describe('panel controller adds a model', () => {
  it('opens the dialog for a route, and closes it again without writing', async () => {
    const { panel, writes } = addBench()
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    expect(panel.getSnapshot().add).toEqual({ routeKey: 'llm-pi-ai/acme', modelId: '', fuzzy: false, searching: false, candidates: [], error: null })
    face.cancelAdd()
    expect(panel.getSnapshot().add).toBeNull()
    expect(writes).toEqual([])
  })

  it('opens no dialog for an adapter preset route, or for a route it never read', async () => {
    const seat = bench({
      directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-api-key', settingsPath: [] }],
      described: described([view('llm-deepseek-api-key', { models: [{ id: 'deepseek-v4-pro', contextWindow: 1000000 }] })]),
      matches: [matchFor('deepseek-official', 'deepseek-v4-pro', { contextWindow: 131072 })],
    })
    seat.panel.inject().ensure()
    await settle()
    seat.panel.inject().addModel('llm-deepseek-api-key/deepseek-official')
    expect(seat.panel.getSnapshot().add).toBeNull()
    seat.panel.inject().addModel('llm-pi-ai/never-read')
    expect(seat.panel.getSnapshot().add).toBeNull()
  })

  it('reports a read-only deployment instead of opening a dialog that cannot be written', async () => {
    const { panel } = addBench({ described: described(
      [view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', input: ['text'] }] } } })],
      false,
    ) })
    panel.inject().ensure()
    await settle()
    panel.inject().addModel('llm-pi-ai/acme')
    expect(panel.getSnapshot()).toMatchObject({ add: null, notice: { kind: 'readonly' } })
  })

  it('asks the catalog about the route the dialog was opened for', async () => {
    const { panel, searches } = addBench({ candidates: [candidate('acme', 'acme-2')] })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(searches).toEqual([{ provider: 'acme', modelId: 'acme-2' }])
    expect(panel.getSnapshot().add).toEqual({
      routeKey: 'llm-pi-ai/acme',
      modelId: 'acme-2',
      fuzzy: false,
      searching: false,
      candidates: [candidate('acme', 'acme-2')],
      error: null,
    })
  })

  it('ignores a search for a dialog that is not open, or for another route', async () => {
    const { panel, searches } = addBench()
    const face = panel.inject()
    face.ensure()
    await settle()
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    face.addModel('llm-pi-ai/acme')
    face.searchModel('llm-deepseek/other', 'acme-2')
    await settle()
    expect(searches).toEqual([])
  })

  it('clears the candidates without searching when the id is emptied', async () => {
    const { panel, searches } = addBench({ candidates: [candidate('acme', 'acme-2')] })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    face.searchModel('llm-pi-ai/acme', '   ')
    await settle()
    expect(searches).toHaveLength(1)
    expect(panel.getSnapshot().add).toMatchObject({ candidates: [], searching: false, error: null })
  })

  it('publishes only the newest of two overlapping searches', async () => {
    const { panel, script } = addBench({ candidates: [candidate('acme', 'acme-2')] })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchModel('llm-pi-ai/acme', 'acme-')
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add).toMatchObject({ modelId: 'acme-2', searching: false })
    expect(script.candidates).toHaveLength(1)
  })

  it('reports a failed search without disturbing the dialog', async () => {
    const { panel } = addBench({ candidatesFailure: new ModelsDevError('the server answered HTTP 503', CATALOG.source) })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add).toMatchObject({ candidates: [], searching: false, error: 'the server answered HTTP 503' })
  })

  it('appends the entry at the first free index and closes the dialog', async () => {
    const { panel, writes } = addBench()
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.submitModel('llm-pi-ai/acme', DRAFT)
    await settle()
    expect(writes).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models', '1'],
      value: { id: 'acme-2', name: 'Acme 2', contextWindow: 200000, maxTokens: 8192, input: ['text', 'image'] },
    }])
    expect(panel.getSnapshot().add).toBeNull()
    expect(panel.getSnapshot().notice).toEqual({ kind: 'added', id: 'acme-2' })
    expect(panel.getSnapshot().writing).toEqual([])
  })

  it('closes the dialog even though its own write makes the Host invalidate the panel', async () => {
    const seat = addBench()
    seat.panel.inject().ensure()
    await settle()
    // Writing a namespace makes the Host broadcast `settings/document-updated`,
    // which starts a re-read underneath the settlement that has to close it.
    seat.script.broadcast = () => { seat.panel.invalidate() }
    seat.panel.inject().addModel('llm-pi-ai/acme')
    seat.panel.inject().submitModel('llm-pi-ai/acme', DRAFT)
    await settle()
    expect(seat.panel.getSnapshot().add).toBeNull()
    expect(seat.panel.getSnapshot().writing).toEqual([])
  })

  it('keeps the dialog open and says so when the namespace refuses the entry', async () => {
    const seat = addBench()
    seat.panel.inject().ensure()
    await settle()
    seat.script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/rejected', 'model ids must be unique', { ns: 'llm-pi-ai' }),
    })
    seat.panel.inject().addModel('llm-pi-ai/acme')
    seat.panel.inject().submitModel('llm-pi-ai/acme', DRAFT)
    await settle()
    expect(seat.panel.getSnapshot().add).not.toBeNull()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'refused', message: 'model ids must be unique' })
  })

  it('reports a stale revision as a conflict and keeps the dialog open', async () => {
    const seat = addBench()
    seat.panel.inject().ensure()
    await settle()
    seat.script.mutate = () => ({
      ok: false,
      error: new RemoteError('settings/conflict', 'the namespace moved', { ns: 'llm-pi-ai', expected: 7, actual: 8 }),
    })
    seat.panel.inject().addModel('llm-pi-ai/acme')
    seat.panel.inject().submitModel('llm-pi-ai/acme', DRAFT)
    await settle()
    expect(seat.panel.getSnapshot().notice).toEqual({ kind: 'conflict' })
    expect(seat.panel.getSnapshot().add).not.toBeNull()
  })

  it('writes no draft the route would refuse, whichever action names it', async () => {
    const seat = addBench()
    const face = seat.panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    for (const draft of [
      { ...DRAFT, id: '   ' },
      { ...DRAFT, id: 'acme-1' },
      { ...DRAFT, contextWindow: 0 },
      { ...DRAFT, maxTokens: -8 },
    ]) {
      face.submitModel('llm-pi-ai/acme', draft)
      await settle()
    }
    expect(seat.writes).toEqual([])
    // The dialog is still open, so the reader can fix the draft rather than
    // start again from an empty id.
    expect(seat.panel.getSnapshot().add).not.toBeNull()
  })

  it('writes nothing into a preset route, or a route the panel never read', async () => {
    const preset = bench({
      directory: [{ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-api-key', settingsPath: [] }],
      described: described([view('llm-deepseek-api-key', { models: [{ id: 'deepseek-v4-pro', contextWindow: 1000000 }] })]),
      matches: [matchFor('deepseek-official', 'deepseek-v4-pro', { contextWindow: 131072 })],
    })
    preset.panel.inject().ensure()
    await settle()
    preset.panel.inject().submitModel('llm-deepseek-api-key/deepseek-official', DRAFT)
    preset.panel.inject().submitModel('llm-pi-ai/never-read', DRAFT)
    await settle()
    expect(preset.writes).toEqual([])
  })

  it('leaves the published state frozen once the controller has been unloaded', async () => {
    const seat = addBench()
    const face = seat.panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.submitModel('llm-pi-ai/acme', DRAFT)
    seat.panel.dispose()
    const frozen = seat.panel.getSnapshot()
    await settle()
    // The write went out, and a panel nobody will read again publishes nothing:
    // the lock it took is never released, because nothing will render it.
    expect(seat.writes).toHaveLength(1)
    expect(seat.panel.getSnapshot()).toBe(frozen)
    expect(frozen).toMatchObject({ notice: null, writing: ['llm-pi-ai'] })
    // The dialog is frozen open too: the settlement that would close it is the
    // one this panel is no longer there to apply.
    expect(frozen.add?.routeKey).toBe('llm-pi-ai/acme')
  })

  it('publishes the close entries a fuzzy search answered with', async () => {
    const similar = [
      { providerId: 'acme', similarity: 'near' as const, distance: 1, model: candidate('acme', 'acme-2').model },
      { providerId: 'other', similarity: 'contains' as const, model: candidate('other', 'acme-2-pro').model },
    ]
    const { panel, searches } = addBench({ similar })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchSimilarModels('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(searches).toEqual([{ provider: 'acme', modelId: 'acme-2' }])
    expect(panel.getSnapshot().add).toMatchObject({ fuzzy: true, searching: false, candidates: similar })
  })

  it('goes back to the exact search as soon as the id is typed again', async () => {
    const { panel } = addBench({ candidates: [candidate('acme', 'acme-2')], similar: [] })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchSimilarModels('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add?.fuzzy).toBe(true)
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add).toMatchObject({ fuzzy: false, candidates: [candidate('acme', 'acme-2')] })
  })

  it('publishes only the newest of an exact search and a fuzzy one', async () => {
    const { panel } = addBench({ similar: [{ providerId: 'acme', similarity: 'near' as const, distance: 1, model: candidate('acme', 'acme-2').model }] })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchSimilarModels('llm-pi-ai/acme', 'acme-2')
    face.searchModel('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add).toMatchObject({ fuzzy: false, searching: false })
  })

  it('reports a failed fuzzy search without disturbing the dialog', async () => {
    const { panel } = addBench({ candidatesFailure: new ModelsDevError('the server answered HTTP 503', CATALOG.source) })
    const face = panel.inject()
    face.ensure()
    await settle()
    face.addModel('llm-pi-ai/acme')
    face.searchSimilarModels('llm-pi-ai/acme', 'acme-2')
    await settle()
    expect(panel.getSnapshot().add).toMatchObject({ fuzzy: true, candidates: [], error: 'the server answered HTTP 503' })
  })
})
