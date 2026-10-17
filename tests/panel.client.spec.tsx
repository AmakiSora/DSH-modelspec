// @vitest-environment jsdom
/**
 * The model-specs panel with its props supplied directly: the cards and rows it
 * draws, the staged edits it holds, the catalog values it shows beside each
 * field, and the dialogs it opens. Nothing here reaches a Host — the panel
 * receives one published state and one set of callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from './support/translate.ts'
import type { ModelsDevState, ModelRowView, RouteView } from '../src/client/store.ts'
import type { ConfiguredModel, ConfiguredRoute } from '../src/client/configured.ts'
import type { ModelsDevModel } from '../src/client/types.ts'
import { en, zh } from '../src/client/locales.ts'
import { ModelsDevPanel, type ModelsDevPanelProps } from '../src/client/ModelsDevPanel.tsx'

/** The state the panel renders when nothing has been read yet. */
const IDLE: ModelsDevState = {
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
  catalogEndpoint: 'https://openrouter.ai/api/v1/models',
  settingsOpen: false,
}

/** One configured model entry. */
function storedModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return { index: 0, id: 'acme-1', name: 'Acme One', contextWindow: 131072, inputModalities: ['text'], modalityField: 'input', ...overrides }
}

/** One published catalog entry. */
function publishedModel(overrides: Partial<ModelsDevModel> = {}): ModelsDevModel {
  return {
    providerId: 'acme',
    id: 'acme-1',
    name: 'Acme One',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputModalities: ['text', 'image'],
    reasoning: true,
    declaredEfforts: { off: null, high: 'high' },
    toolCall: true,
    structuredOutput: false,
    temperature: true,
    ...overrides,
  }
}

/** One configured route. */
function storedRoute(overrides: Partial<ConfiguredRoute> = {}): ConfiguredRoute {
  return {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    displayName: 'Acme',
    settingsPath: ['providers', 'acme'],
    revision: 3,
    arrayLength: 1,
    preset: false,
    reasoningCapable: true,
    models: [storedModel()],
    ...overrides,
  }
}

/** One model row of the published state. */
function rowView(model: ConfiguredModel, published?: ModelsDevModel, differences: ModelRowView['differences'] = []): ModelRowView {
  return {
    key: `llm-pi-ai/acme/${String(model.index)}`,
    model,
    match: published === undefined
      ? { provider: 'acme', modelId: model.id, strategy: 'none' }
      : {
        provider: 'acme',
        modelId: model.id,
        routeProviderKey: 'acme',
        providerKey: 'acme',
        strategy: 'exact',
        model: published,
      },
    differences,
  }
}

/** One route of the published state. */
function routeView(models: readonly ModelRowView[], route: ConfiguredRoute = storedRoute()): RouteView {
  return { key: 'llm-pi-ai/acme', route, models }
}

/** The state the panel renders for one differing model. */
function ready(): ModelsDevState {
  const model = storedModel()
  return {
    ...IDLE,
    status: 'ready',
    writable: true,
    catalog: {
      source: 'https://openrouter.ai/api/v1/models',
      fetchedAt: 4242,
      providers: [{ id: 'acme', name: 'Acme', modelCount: 1 }],
      modelCount: 1,
      skippedCount: 0,
    },
    routes: [routeView([rowView(model, publishedModel(), [
      { field: 'contextWindow', configured: 131072, published: 1048576 },
      { field: 'input', configured: ['text'], published: ['text', 'image'] },
    ])])],
  }
}

/** The state one route with one matching model renders. */
function matching(): ModelsDevState {
  const model = storedModel({ contextWindow: 1048576 })
  return { ...ready(), routes: [routeView([rowView(model, publishedModel())])] }
}

/** The props a test hands the panel, over one published state. */
function props(state: ModelsDevState): ModelsDevPanelProps {
  return {
    t: makeTranslate(en),
    useModelsDev: () => state,
    ensure: vi.fn(),
    refresh: vi.fn(),
    openSettings: vi.fn(),
    saveEndpoint: vi.fn(),
    cancelSettings: vi.fn(),
    adoptAll: vi.fn(),
    saveRoute: vi.fn(),
    openAdd: vi.fn(),
    openEntry: vi.fn(),
    searchModel: vi.fn(),
    discoverModels: vi.fn(),
    addModel: vi.fn(),
    bindEntry: vi.fn(),
    removeModel: vi.fn(),
    cancelEditor: vi.fn(),
  } as unknown as ModelsDevPanelProps
}

/** Render the panel over one state. */
function panel(state: ModelsDevState): ModelsDevPanelProps {
  const injected = props(state)
  render(<ModelsDevPanel {...injected} />)
  return injected
}

/** Expand one model row's specification fields. */
function expand(position = 1): void {
  fireEvent.click(screen.getByRole('button', { name: `Parameters ${String(position)}` }))
}

/** The input a field label names. */
function field(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name })
}

/** The calls one action recorded. */
function calls(action: unknown): unknown[][] {
  return (action as unknown as { mock: { calls: unknown[][] } }).mock.calls
}

/** One editor state for the dialogs under test. */
function editorState(overrides: Partial<NonNullable<ModelsDevState['editor']>> = {}): NonNullable<ModelsDevState['editor']> {
  return {
    mode: 'add',
    routeKey: 'llm-pi-ai/acme',
    modelKey: null,
    modelId: '',
    fuzzy: false,
    searching: false,
    candidates: [],
    error: null,
    discovering: false,
    discovered: null,
    discoverError: null,
    ...overrides,
  }
}

describe('the model specs panel', () => {
  afterEach(cleanup)

  it('reads its configuration once on the first mount', () => {
    const injected = props(IDLE)
    render(<ModelsDevPanel {...injected} />)
    expect(injected.ensure).toHaveBeenCalledTimes(1)
  })

  it('shows the catalog address and the counts it compared against', () => {
    panel(ready())
    expect(screen.getByText(/openrouter\.ai\/api\/v1\/models/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Models' })).toBeTruthy()
  })

  it('draws one card per route, with its name, its route id and its tags', () => {
    panel(ready())
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.getByText('acme', { selector: 'code' })).toBeTruthy()
    expect(screen.getByText('Custom')).toBeTruthy()
    expect(screen.getByText('2 differ')).toBeTruthy()
  })

  it('says a route matches the catalog when nothing differs', () => {
    panel(matching())
    expect(screen.getByText('Matches the catalog')).toBeTruthy()
  })

  it('opens on the stored values, not on the published ones', () => {
    panel(ready())
    expect(field('Model id 1').value).toBe('acme-1')
    expect(field('Display name 1').value).toBe('Acme One')
    expand()
    expect(field('Context length').value).toBe('131072')
  })

  it('shows the published value beside every field it can fill', () => {
    panel(ready())
    expand()
    expect(screen.getByText('Catalog publishes 1048576')).toBeTruthy()
    expect(screen.getByText('Catalog publishes Text + Image')).toBeTruthy()
    expect(screen.getByText('Catalog publishes off=∅ · high=high')).toBeTruthy()
  })

  it('names the entry the row is compared against', () => {
    panel(ready())
    expand()
    expect(screen.getByText(/Entry: acme\/acme-1 \(identical model id\)/)).toBeTruthy()
  })

  it('does not repeat a vendor prefix the published id already carries', () => {
    const model = storedModel({ id: 'deepseek/deepseek-v4-flash' })
    const entry = publishedModel({ providerId: 'deepseek', id: 'deepseek/deepseek-v4-flash' })
    panel({
      ...ready(),
      routes: [routeView([
        {
          key: 'llm-pi-ai/acme/0',
          model,
          match: {
            provider: 'acme',
            modelId: model.id,
            routeProviderKey: 'deepseek',
            providerKey: 'deepseek',
            strategy: 'exact',
            model: entry,
          },
          differences: [],
        },
      ], storedRoute({ models: [model] }))],
    })
    expand()
    expect(screen.getByText(/Entry: deepseek\/deepseek-v4-flash \(/)).toBeTruthy()
  })

  it('names the way out for a row the catalog cannot reach', () => {
    panel({ ...ready(), routes: [routeView([rowView(storedModel(), undefined, [])], storedRoute())] })
    expand()
    expect(screen.getByText(/The catalog has no entry for this id/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change entry' })).toBeTruthy()
  })

  it('stages a field edit, then applies the whole card through one action', () => {
    const injected = panel(ready())
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const [routeKey, edits] = calls(injected.saveRoute)[0] ?? []
    expect(routeKey).toBe('llm-pi-ai/acme')
    const staged = edits as readonly { modelKey: string; draft: { contextWindow: string } }[]
    expect(staged[0]?.modelKey).toBe('llm-pi-ai/acme/0')
    expect(staged[0]?.draft.contextWindow).toBe('2048')
  })

  it('writes nothing until the staged edit is applied', () => {
    const injected = panel(ready())
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    expect(injected.saveRoute).not.toHaveBeenCalled()
    expect(injected.adoptAll).not.toHaveBeenCalled()
  })

  it('discards a staged edit and restores the stored value', () => {
    panel(ready())
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(field('Context length').value).toBe('131072')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('adopts one published field into the staged values', () => {
    panel(ready())
    expand()
    const hint = screen.getByText('Catalog publishes 1048576').parentElement
    fireEvent.click(within(hint as HTMLElement).getByRole('button', { name: 'Adopt' }))
    expect(field('Context length').value).toBe('1048576')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('adopts every published value of a card, and writes none of them', () => {
    const injected = panel(ready())
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Adopt published values' }))
    expect(field('Context length').value).toBe('1048576')
    expect(field('Max output').value).toBe('8192')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    expect(injected.saveRoute).not.toHaveBeenCalled()
  })

  it('stages the outright non-reasoning declaration from the checkbox', () => {
    const injected = panel(ready())
    expand()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Non-reasoning model (writes false)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const [, edits] = calls(injected.saveRoute)[0] ?? []
    const staged = edits as readonly { draft: { reasoning: { mode: string } } }[]
    expect(staged[0]?.draft.reasoning.mode).toBe('none')
  })

  it('stages the published reasoning levels when the switch is turned on', () => {
    panel(ready())
    expand()
    fireEvent.click(screen.getByRole('switch', { name: 'Declares reasoning efforts' }))
    expect(screen.getAllByRole('combobox').length).toBe(2)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('applies every difference through the bulk action', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Adopt all differences' }))
    expect(injected.adoptAll).toHaveBeenCalledTimes(1)
  })

  it('refuses the bulk action while a card holds staged edits', () => {
    panel(ready())
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    const bulk = screen.getByRole<HTMLButtonElement>('button', { name: 'Adopt all differences' })
    expect(bulk.disabled).toBe(true)
    expect(bulk.title).toBe('Apply or cancel the edits on each card before adopting everything.')
  })

  it('re-reads the catalog on request', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }))
    expect(injected.refresh).toHaveBeenCalled()
  })

  it('opens the catalog settings dialog from the header button', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Catalog settings' }))
    expect(injected.openSettings).toHaveBeenCalled()
  })

  it('disables every write in a deployment that does not accept settings writes', () => {
    panel({ ...ready(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Adopt all differences' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Adopt published values' }).disabled).toBe(true)
    expect(field('Model id 1').disabled).toBe(true)
    expect(screen.getByText(/does not accept settings writes/)).toBeTruthy()
  })

  it('compares an adapter preset route but offers no write for it', () => {
    panel({
      ...ready(),
      routes: [routeView([rowView(storedModel(), publishedModel())], storedRoute({ preset: true }))],
    })
    expect(screen.getByText('Official preset · read-only')).toBeTruthy()
    expect(screen.getByText(/never written/)).toBeTruthy()
    expect(field('Model id 1').disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add model' }).disabled).toBe(true)
  })

  it('shows no add-model action while a write for the route is in flight', () => {
    panel({ ...ready(), writing: ['llm-pi-ai'] })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add model' }).disabled).toBe(true)
  })

  it('reports a configured route whose own configuration the directory flags', () => {
    panel({ ...ready(), routes: [routeView([rowView(storedModel(), publishedModel())], storedRoute({ error: 'no key' }))] })
    expect(screen.getByText('Configuration diagnostic: no key')).toBeTruthy()
  })

  it('reports a route the catalog has no provider for', () => {
    panel({ ...ready(), routes: [routeView([rowView(storedModel(), undefined, [])], storedRoute())] })
    expect(screen.getByText('The catalog has no provider matching this route')).toBeTruthy()
  })

  it('says a deployment with no configured route has nothing to compare', () => {
    panel({ ...ready(), routes: [] })
    expect(screen.getByText(/configures no models to compare/)).toBeTruthy()
  })

  it('reports the failed read and offers no comparison', () => {
    panel({ ...ready(), status: 'error', error: 'socket gone' })
    expect(screen.getByText('socket gone')).toBeTruthy()
  })

  it('renders the configured rows beside a catalog failure instead of nothing', () => {
    panel({ ...ready(), catalog: null, catalogError: 'catalog unavailable' })
    expect(screen.getByText(/catalog unavailable/)).toBeTruthy()
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.getByText('The catalog is unavailable, so nothing can be compared')).toBeTruthy()
  })

  it('says the panel is loading while the first read runs', () => {
    panel({ ...ready(), status: 'loading' })
    expect(screen.getByText(/Reading the model catalog/)).toBeTruthy()
  })

  it('reports each write outcome as its own status line', () => {
    const notices: readonly [ModelsDevState['notice'], RegExp][] = [
      [{ kind: 'applied' }, /edits on the card were written/],
      [{ kind: 'adopted' }, /difference was written/],
      [{ kind: 'added', id: 'acme-2' }, /acme-2 was added/],
      [{ kind: 'removed', id: 'acme-1' }, /acme-1 was removed/],
      [{ kind: 'bound' }, /entry was pinned/],
      [{ kind: 'conflict' }, /another window/],
      [{ kind: 'refused', message: 'nope' }, /not written: nope/],
      [{ kind: 'readonly' }, /does not accept settings writes/],
      [{ kind: 'invalid', problem: 'invalid-context' }, /positive integer/],
    ]
    for (const [notice, text] of notices) {
      panel({ ...ready(), notice })
      expect(screen.getByText(text)).toBeTruthy()
      cleanup()
    }
  })

  it('folds a card without dropping its staged edits', () => {
    panel(ready())
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    expect(screen.queryByRole('textbox', { name: 'Model id 1' })).toBeNull()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    expand()
    expect(field('Context length').value).toBe('2048')
  })

  it('serves the panel in Chinese as well as English', () => {
    render(<ModelsDevPanel {...props(ready())} t={makeTranslate(zh)} />)
    expect(screen.getByRole('heading', { name: '模型' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '采纳全部差异' })).toBeTruthy()
  })
})

describe('adding a model from the panel', () => {
  afterEach(cleanup)

  it('opens the add dialog for the route whose button was pressed', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
    expect(injected.openAdd).toHaveBeenCalledWith('llm-pi-ai/acme')
  })

  it('asks the catalog about every id it is typed', () => {
    const injected = panel({ ...ready(), editor: editorState() })
    const dialog = screen.getByRole('dialog', { name: 'Add a model' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Model id' }), { target: { value: 'acme-9' } })
    expect(injected.searchModel).toHaveBeenCalledWith('acme-9', false)
  })

  it('offers the catalog entries one id reached, with the provider they came from', () => {
    const injected = panel({
      ...ready(),
      editor: editorState({
        modelId: 'acme',
        candidates: [
          { providerId: 'acme', model: publishedModel({ id: 'acme-1' }), strategy: 'exact' },
          { providerId: 'other', model: publishedModel({ id: 'acme-2', name: 'Acme Two' }), strategy: 'bare' },
        ],
      }),
    })
    const dialog = screen.getByRole('dialog', { name: 'Add a model' })
    expect(within(dialog).getByText('other')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Acme Two/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    const [entry, binding] = calls(injected.addModel)[0] ?? []
    expect(binding).toEqual({ providerId: 'other', modelId: 'acme-2' })
    expect(entry).toMatchObject({ id: 'acme', contextWindow: 1048576, reasoningEfforts: { off: null, high: 'high' } })
  })

  it('reports the reason a draft cannot be added', () => {
    panel({ ...ready(), editor: editorState({ modelId: 'acme-1' }) })
    expect(screen.getByRole('alert').textContent).toContain('already configures that model id')
  })

  it('asks the route which models it serves', () => {
    const injected = panel({ ...ready(), editor: editorState() })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch available models' }))
    expect(injected.discoverModels).toHaveBeenCalled()
  })

  it('offers what the endpoint listed, and narrows it by the query', () => {
    panel({
      ...ready(),
      editor: editorState({
        discovered: [
          { id: 'acme-3', name: 'Three' },
          { id: 'acme-4', name: 'Four' },
        ],
      }),
    })
    const dialog = screen.getByRole('dialog', { name: 'Add a model' })
    expect(within(dialog).getByText('The provider listed 2 available models — choose a model id')).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search model ids' }), { target: { value: 'four' } })
    expect(within(dialog).getByText('1 listed models match')).toBeTruthy()
    expect(within(dialog).getByText('acme-4')).toBeTruthy()
  })

  it('closes without writing when the dialog is cancelled', () => {
    const injected = panel({ ...ready(), editor: editorState({ modelId: 'acme-9' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(injected.cancelEditor).toHaveBeenCalled()
    expect(injected.addModel).not.toHaveBeenCalled()
  })
})

describe('pinning the entry a model follows', () => {
  afterEach(cleanup)

  it('opens on the model the row belongs to', () => {
    const injected = panel(ready())
    expand()
    fireEvent.click(screen.getByRole('button', { name: 'Change entry' }))
    expect(injected.openEntry).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
  })

  it('pins the chosen entry and fills the card from it', () => {
    const injected = panel({
      ...ready(),
      editor: editorState({
        mode: 'entry',
        modelKey: 'llm-pi-ai/acme/0',
        modelId: 'acme-1',
        candidates: [{ providerId: 'acme', model: publishedModel(), strategy: 'exact' }],
      }),
    })
    const dialog = screen.getByRole('dialog', { name: 'Catalog entry' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(injected.bindEntry).toHaveBeenCalledWith({ providerId: 'acme', modelId: 'acme-1' })
  })

  it('returns the model to the automatic match', () => {
    const injected = panel({ ...ready(), editor: editorState({ mode: 'entry', modelKey: 'llm-pi-ai/acme/0', modelId: 'acme-1' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Match automatically from the model id' }))
    expect(injected.bindEntry).toHaveBeenCalledWith(null)
  })
})

describe('removing a model from the panel', () => {
  afterEach(cleanup)

  it('asks before it removes anything', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Remove model 1' }))
    expect(injected.removeModel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Remove model' })).toBeTruthy()
  })

  it('removes the model the reader confirmed', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Remove model 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(injected.removeModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
  })

  it('removes nothing when the reader backs out', () => {
    const injected = panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Remove model 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(injected.removeModel).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Remove model' })).toBeNull()
  })

  it('warns that removing the only model takes the provider off the panel', () => {
    panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Remove model 1' }))
    expect(screen.getByText(/only model this provider stores/)).toBeTruthy()
  })
})

describe('a staged draft whose row moved underneath it', () => {
  afterEach(cleanup)

  it('is dropped rather than shown against the model that now sits at its address', () => {
    const state = ready()
    const { rerender } = render(<ModelsDevPanel {...props(state)} />)
    expand()
    fireEvent.change(field('Context length'), { target: { value: '2048' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    // The row is re-read with another model at the same index: the staged values
    // belong to the model that is no longer there.
    const moved = storedModel({ id: 'acme-9', name: 'Acme Nine', contextWindow: 4096 })
    rerender(<ModelsDevPanel {...props({
      ...state,
      routes: [routeView([rowView(moved, publishedModel({ id: 'acme-9' }), [])], storedRoute({ models: [moved] }))],
    })} />)
    expect(field('Model id 1').value).toBe('acme-9')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})

describe('a card holding several rows', () => {
  afterEach(cleanup)

  it('sends every row, so the store can skip the ones that changed nothing', () => {
    const first = storedModel()
    const second = storedModel({ index: 1, id: 'acme-2', name: 'Acme Two' })
    const injected = panel({
      ...ready(),
      routes: [routeView([
        rowView(first, publishedModel()),
        rowView(second, publishedModel({ id: 'acme-2' })),
      ], storedRoute({ models: [first, second], arrayLength: 2 }))],
    })
    expand(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Context length' }), { target: { value: '4096' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const [, edits] = calls(injected.saveRoute)[0] ?? []
    expect((edits as readonly unknown[]).length).toBe(2)
    expect((edits as readonly { modelKey: string }[])[1]?.modelKey).toBe('llm-pi-ai/acme/1')
  })
})
