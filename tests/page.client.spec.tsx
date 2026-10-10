// @vitest-environment jsdom
/**
 * The models.dev panel with its props supplied directly: the comparison it is
 * handed, the actions it offers, and the diagnostics it reports for every
 * state the Host can leave the panel in.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from './support/translate.ts'
import type { ModelsDevState } from '../src/client/store.ts'
import type { ModelsDevOption, ModelsDevSimilarity } from '../src/client/types.ts'
import { en } from '../src/client/locales.ts'
import { ModelsDevPage, type ModelsDevPageProps } from '../src/client/ModelsDevPage.tsx'

/** The state the panel renders when nothing has been read yet. */
const IDLE: ModelsDevState = {
  status: 'idle',
  error: null,
  writable: false,
  catalog: null,
  refreshing: false,
  routes: [],
  writing: [],
  notice: null,
  add: null,
}

/** One configured model row. */
function row(key: string, id: string, differences: ModelsDevState['routes'][number]['models'][number]['differences']): ModelsDevState['routes'][number]['models'][number] {
  return {
    key,
    model: { index: 0, id, inputModalities: ['text'], modalityField: 'input' },
    match: {
      provider: 'acme',
      modelId: id,
      routeProviderKey: 'acme',
      providerKey: 'acme',
      strategy: 'exact',
      model: {
        providerId: 'acme',
        id,
        name: id,
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
        reasoning: true,
        toolCall: true,
        structuredOutput: false,
        temperature: true,
        releaseDate: '2026-01-02',
        cost: { input: 1, output: 2 },
      },
    },
    differences,
  }
}

/** One route holding one model whose published values differ. */
function readyRoute(): ModelsDevState['routes'][number] {
  return {
    key: 'llm-pi-ai/acme',
    route: {
      settingsNs: 'llm-pi-ai',
      provider: 'acme',
      displayName: 'Acme',
      settingsPath: ['providers', 'acme'],
      revision: 3,
      arrayLength: 1,
      preset: false,
      // The same entry the rows below describe: the add dialog reads the route's
      // own models for its template and its duplicate rule, so a fixture that
      // published rows without them would test an empty route.
      models: [{ index: 0, id: 'acme-1', contextWindow: 131072, maxTokens: 4096, inputModalities: ['text'], modalityField: 'input' }],
    },
    models: [row('llm-pi-ai/acme/0', 'acme-1', [
      { field: 'contextWindow', configured: 131072, published: 1048576 },
      { field: 'input', configured: ['text'], published: ['text', 'image'] },
    ])],
  }
}

/** The state the panel renders for one route with one differing model. */
function ready(): ModelsDevState {
  return {
    ...IDLE,
    status: 'ready',
    writable: true,
    catalog: {
      source: 'https://models.dev/api.json',
      fetchedAt: 4242,
      providers: [{ id: 'acme', name: 'Acme', modelCount: 1 }],
      modelCount: 1,
      skippedCount: 0,
    },
    routes: [readyRoute()],
  }
}

/** The props a test hands the panel, over one published state. */
function props(state: ModelsDevState): ModelsDevPageProps {
  return {
    t: makeTranslate(en),
    useModelsDev: () => state,
    ensure: vi.fn(),
    refresh: vi.fn(),
    applyModel: vi.fn(),
    applyRoute: vi.fn(),
    applyAll: vi.fn(),
    addModel: vi.fn(),
    searchModel: vi.fn(),
    searchSimilarModels: vi.fn(),
    submitModel: vi.fn(),
    cancelAdd: vi.fn(),
  } as unknown as ModelsDevPageProps
}

/** One published entry with no price at all, which the type models as absent rather than undefined. */
function withoutPrice(model: NonNullable<ModelsDevState['routes'][number]['models'][number]['match']['model']>): NonNullable<ModelsDevState['routes'][number]['models'][number]['match']['model']> {
  const { cost: _omitted, ...rest } = model
  return rest
}

/** The ready state with one different route. */
function withRoute(route: ModelsDevState['routes'][number], extra?: ModelsDevState['routes'][number]): ModelsDevState {
  return extra === undefined ? { ...ready(), routes: [route] } : { ...ready(), routes: [route, extra] }
}

/** Render the panel over one state. */
function panel(state: ModelsDevState): void {
  render(<ModelsDevPage {...props(state)} />)
}

describe('models.dev page', () => {
  afterEach(cleanup)

  it('reads its configuration once on the first mount', () => {
    const injected = props(IDLE)
    render(<ModelsDevPage {...injected} />)
    expect(injected.ensure).toHaveBeenCalledTimes(1)
  })

  it('shows the catalog address and the counts it compared against', () => {
    panel(ready())
    expect(screen.getByText(/models\.dev\/api\.json/)).toBeTruthy()
  })

  it('names the field, the stored value, and the published one for each difference', () => {
    panel(ready())
    expect(screen.getByText('Context length')).toBeTruthy()
    expect(screen.getByText('131072')).toBeTruthy()
    expect(screen.getByText('1048576')).toBeTruthy()
    expect(screen.getByText('Input types')).toBeTruthy()
    expect(screen.getByText('Text')).toBeTruthy()
    expect(screen.getByText('Text + Image')).toBeTruthy()
  })

  it('shows the matching strategy, the entry provider, and the published facts', () => {
    panel(ready())
    expect(screen.getByText(/Matched by: identical model id/)).toBeTruthy()
    expect(screen.getByText(/Entry from: acme/)).toBeTruthy()
    expect(screen.getByText('Reasoning · Supported')).toBeTruthy()
    expect(screen.getByText('Tool calls · Supported')).toBeTruthy()
    expect(screen.getByText('Structured output · Not supported')).toBeTruthy()
    expect(screen.getByText('Temperature · Supported')).toBeTruthy()
    expect(screen.getByText('Price: $1 in / $2 out per million tokens')).toBeTruthy()
    expect(screen.getByText('Released 2026-01-02')).toBeTruthy()
  })

  it('applies one model, one route, or the whole page through the actions it was given', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(screen.getByRole('button', { name: "Apply this provider's differences" }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }))
    expect(injected.applyModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    expect(injected.applyRoute).toHaveBeenCalledWith('llm-pi-ai/acme')
    expect(injected.applyAll).toHaveBeenCalledTimes(1)
  })

  it('re-reads the catalog on request', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Query again' }))
    expect(injected.refresh).toHaveBeenCalled()
  })

  it('disables every write in a deployment that does not accept settings writes', () => {
    panel({ ...ready(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply all' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true)
    expect(screen.getByText(/does not accept settings writes/)).toBeTruthy()
  })

  it('says a model already matching the published values is up to date and offers no write', () => {
    panel(withRoute({ ...readyRoute(), models: [row('llm-pi-ai/acme/0', 'acme-1', [])] }))
    expect(screen.getByText('The local configuration already matches models.dev')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply all' }).disabled).toBe(true)
  })

  it('reports a model the catalog answered nothing for', () => {
    panel(withRoute({
      ...readyRoute(),
      models: [{
        key: 'llm-pi-ai/acme/0',
        model: { index: 0, id: 'gone', inputModalities: [], modalityField: 'input' },
        match: { provider: 'acme', modelId: 'gone', routeProviderKey: 'acme', strategy: 'none' },
        differences: [],
      }],
    }))
    expect(screen.getByText('models.dev has no matching entry')).toBeTruthy()
  })

  it('reports a route that has no models.dev provider of its own', () => {
    panel(withRoute({
      ...readyRoute(),
      models: [{
        key: 'llm-pi-ai/acme/0',
        model: { index: 0, id: 'acme-1', inputModalities: [], modalityField: 'input' },
        match: { provider: 'acme', modelId: 'acme-1', strategy: 'none' },
        differences: [],
      }],
    }))
    expect(screen.getByText('models.dev has no provider matching this route')).toBeTruthy()
  })

  it('reports a configured route whose own configuration the directory flags', () => {
    const route = readyRoute()
    panel(withRoute({
      ...route,
      route: { ...route.route, error: 'contextWindow must be a positive integer' },
    }))
    expect(screen.getByText(/Configuration diagnostic: /)).toBeTruthy()
  })

  it('folds and unfolds one route without touching the others', () => {
    const other = readyRoute()
    panel(withRoute({ ...readyRoute() }, {
      ...other,
      key: 'llm-pi-ai/other',
      route: { ...other.route, provider: 'other', displayName: 'Other' },
      models: [row('llm-pi-ai/other/0', 'other-1', [])],
    }))
    const folds = screen.getAllByRole('button', { expanded: true })
    expect(folds).toHaveLength(2)
    expect(screen.getByText('1 differ')).toBeTruthy()
    expect(screen.getByText('All match')).toBeTruthy()

    fireEvent.click(folds[0] as HTMLElement)
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1)
    // The folded route keeps its header; only its model rows leave the page.
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(2)
  })

  it('says a deployment with no configured route has nothing to compare', () => {
    panel({ ...IDLE, status: 'ready', writable: true })
    expect(screen.getByText(/no model configuration to compare/)).toBeTruthy()
  })

  it('compares an adapter preset route but offers no write for it', () => {
    const preset = readyRoute()
    panel(withRoute({ ...preset, route: { ...preset.route, provider: 'deepseek-official', displayName: 'DeepSeek', preset: true } }))
    // The differences are still reported…
    expect(screen.getByText('1048576')).toBeTruthy()
    expect(screen.getByText('Official preset · compared only')).toBeTruthy()
    // …but nothing about that route, or the page as a whole, can be written.
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: "Apply this provider's differences" }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply all' }).disabled).toBe(true)
  })

  it('still writes the deployment routes around a preset one', () => {
    const preset = readyRoute()
    const injected = props(withRoute(readyRoute(), {
      ...preset,
      key: 'llm-deepseek-api-key/deepseek-official',
      route: { ...preset.route, provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-api-key', settingsPath: [], preset: true },
      models: [row('llm-deepseek-api-key/deepseek-official/0', 'deepseek-v4-pro', [
        { field: 'contextWindow', configured: 1000000, published: 131072 },
      ])],
    }))
    render(<ModelsDevPage {...injected} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply all' }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Apply all' }))
    expect(injected.applyAll).toHaveBeenCalledTimes(1)
  })

  it('reports the failed read and offers no comparison', () => {
    panel({ ...IDLE, status: 'error', error: 'the server answered HTTP 503' })
    expect(screen.getByText('The models.dev catalog could not be read')).toBeTruthy()
    expect(screen.getByText(/the server answered HTTP 503/)).toBeTruthy()
  })

  it('says the panel is loading while the first read runs', () => {
    panel({ ...IDLE, status: 'loading' })
    expect(screen.getByText(/Reading the models\.dev catalog/)).toBeTruthy()
  })

  it('reports each write outcome as its own status line', () => {
    for (const [notice, expected] of [
      [{ kind: 'applied' }, 'The selected model parameters were written.'],
      [{ kind: 'conflict' }, 'The configuration changed in another window. Query again before applying.'],
      [{ kind: 'readonly' }, 'This deployment does not accept settings writes.'],
      [{ kind: 'refused', message: 'model ids must be unique' }, 'The configuration was not written: model ids must be unique'],
    ] as const) {
      const view = render(<ModelsDevPage {...props({ ...ready(), notice })} />)
      expect(screen.getByText(expected)).toBeTruthy()
      view.unmount()
    }
  })

  it('marks a deprecated catalog entry and shows its description', () => {
    const only = readyRoute().models[0]!
    panel(withRoute({
      ...readyRoute(),
      models: [{
        ...only,
        match: {
          ...only.match,
          model: { ...only.match.model!, status: 'deprecated', description: 'Retained for compatibility.' },
        },
      }],
    }))
    expect(screen.getByText('Deprecated')).toBeTruthy()
    expect(screen.getByText('Retained for compatibility.')).toBeTruthy()
  })

  it('shows a partial published price, and none at all when the entry publishes no price', () => {
    const partialOnly = readyRoute().models[0]!
    const partialView = render(<ModelsDevPage {...props(withRoute({
      ...readyRoute(),
      models: [{ ...partialOnly, match: { ...partialOnly.match, model: { ...partialOnly.match.model!, cost: { input: 3 } } } }],
    }))} />)
    expect(screen.getByText('Price: 3 in / - out per million tokens')).toBeTruthy()
    partialView.unmount()

    const bareOnly = readyRoute().models[0]!
    const bareView = render(<ModelsDevPage {...props(withRoute({
      ...readyRoute(),
      models: [{ ...bareOnly, match: { ...bareOnly.match, model: withoutPrice(bareOnly.match.model!) } }],
    }))} />)
    expect(screen.queryByText(/Price: /)).toBeNull()
    bareView.unmount()
  })

  it('says a catalog re-read is running', () => {
    panel({ ...ready(), refreshing: true })
    expect(screen.getByText(/Querying again/)).toBeTruthy()
  })
})

/** One catalog entry the add dialog can offer. */
function candidate(providerId: string, id: string, published: Record<string, unknown> = {}): ModelsDevCandidate {
  return {
    providerId,
    strategy: 'exact',
    model: {
      providerId,
      id,
      name: `${id} name`,
      inputModalities: ['text'],
      reasoning: false,
      toolCall: true,
      structuredOutput: false,
      temperature: true,
      ...published,
    },
  }
}

/** The ready state with the add dialog open for the first route. */
function adding(overrides: Partial<NonNullable<ModelsDevState['add']>> = {}): ModelsDevState {
  return {
    ...ready(),
    add: { routeKey: 'llm-pi-ai/acme', modelId: '', fuzzy: false, searching: false, candidates: [], error: null, ...overrides },
  }
}

/** The dialog itself, so a spec can assert inside it. */
function dialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Add a model' })
}

/** Type into one of the dialog's labelled fields. */
function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** The value one of the dialog's labelled fields holds. */
function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

describe('adding a model', () => {
  afterEach(cleanup)

  it('opens the dialog for the route whose button was pressed', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
    expect(injected.addModel).toHaveBeenCalledWith('llm-pi-ai/acme')
  })

  it('opens no dialog for an adapter preset route', () => {
    const preset = readyRoute()
    panel(withRoute({ ...preset, route: { ...preset.route, preset: true } }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add model' }).disabled).toBe(true)
  })

  it('offers no add button in a deployment that does not accept settings writes', () => {
    panel({ ...ready(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add model' }).disabled).toBe(true)
  })

  it('asks the catalog about every id it is given', () => {
    const injected = props(adding())
    render(<ModelsDevPage {...injected} />)
    type('Model id', 'acme-2')
    expect(injected.searchModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'acme-2')
  })

  it('names the provider the dialog is adding to', () => {
    panel(adding())
    expect(dialog().textContent).toContain('Acme')
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('fills the fields from the one entry the catalog answered with', () => {
    panel(adding({
      modelId: 'acme-2',
      candidates: [candidate('acme', 'acme-2', { contextWindow: 200000, maxOutputTokens: 8192, inputModalities: ['text', 'image'] })],
    }))
    expect(screen.getByText(/Matched automatically: identical model id/)).toBeTruthy()
    expect(field('Display name (optional)').value).toBe('acme-2 name')
    expect(field('Context length').value).toBe('200000')
    expect(field('Max output').value).toBe('8192')
    expect((screen.getByLabelText('Accepts image input') as HTMLInputElement).checked).toBe(true)
  })

  it('shows no chooser at all when only one entry matched', () => {
    panel(adding({ candidates: [candidate('acme', 'acme-2')] }))
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('offers every entry when the id reached more than one', () => {
    panel(adding({
      modelId: 'acme-2',
      candidates: [
        candidate('openai', 'acme-2', { contextWindow: 200000 }),
        candidate('azure', 'acme-2', { contextWindow: 128000, maxOutputTokens: 4096 }),
      ],
    }))
    expect(screen.getByText('2 entries matched — choose one')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    // Nothing is chosen until the reader picks, so no entry silently wins and
    // the route's own template stands until then.
    expect(field('Context length').value).toBe('131072')
  })

  it('refills the preview from whichever entry is chosen', () => {
    panel(adding({
      modelId: 'acme-2',
      candidates: [
        candidate('openai', 'acme-2', { contextWindow: 200000 }),
        candidate('azure', 'acme-2', { contextWindow: 128000, maxOutputTokens: 4096 }),
      ],
    }))
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
    expect(field('Context length').value).toBe('200000')
    expect((screen.getAllByRole('radio')[0] as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect((screen.getAllByRole('radio')[1] as HTMLElement).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the entry the reader chose when the same search publishes again', () => {
    const candidates = [
      candidate('openai', 'acme-2', { contextWindow: 200000 }),
      candidate('azure', 'acme-2', { contextWindow: 128000 }),
    ]
    const view = render(<ModelsDevPage {...props(adding({ modelId: 'acme-2', candidates }))} />)
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement)
    type('Context length', '999')
    // The Host broadcast the write that closed the dialog and republishes the
    // rows; a fresh search for the same id must not undo the reader's edits.
    view.rerender(<ModelsDevPage {...props(adding({ modelId: 'acme-2', candidates }))} />)
    expect(field('Context length').value).toBe('999')
  })

  it('falls back to the route default template when nothing matched', () => {
    panel(adding({ modelId: 'never-published', candidates: [] }))
    expect(screen.getByText(/models\.dev has no matching entry/)).toBeTruthy()
    // The donor is the route's only model, so the template is that entry's own
    // capacities: 131072 context, 4096 output, text only, stored under `input`.
    expect(field('Context length').value).toBe('131072')
    expect(field('Max output').value).toBe('4096')
    expect((screen.getByLabelText('Accepts image input') as HTMLInputElement).checked).toBe(false)
  })

  it('says a failed lookup fell back to the template rather than reporting nothing', () => {
    panel(adding({ modelId: 'acme-2', candidates: [], error: 'the server answered HTTP 503' }))
    expect(screen.getByText(/The models\.dev lookup failed/)).toBeTruthy()
    expect(screen.queryByRole('alert')?.textContent).not.toContain('503')
  })

  it('says it is still looking an id up', () => {
    panel(adding({ modelId: 'acme-', searching: true }))
    expect(screen.getByText(/Looking the model up in models\.dev/)).toBeTruthy()
  })

  it('hands over the entry with the modality family its namespace uses', () => {
    const injected = props(adding())
    render(<ModelsDevPage {...injected} />)
    type('Model id', 'acme-2')
    type('Display name (optional)', '  Acme 2  ')
    type('Context length', '200000')
    fireEvent.click(screen.getByLabelText('Accepts image input'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(injected.submitModel).toHaveBeenCalledWith('llm-pi-ai/acme', {
      id: 'acme-2',
      name: '  Acme 2  ',
      contextWindow: 200000,
      // The template's output cap is still in the field: only the reader clearing
      // a value takes it out of the entry.
      maxTokens: 4096,
      inputModalities: ['text', 'image'],
      modalityField: 'input',
    })
  })

  it('leaves a capacity the reader cleared out of the entry', () => {
    const injected = props(adding({ candidates: [candidate('acme', 'acme-2', { contextWindow: 200000 })] }))
    render(<ModelsDevPage {...injected} />)
    type('Model id', 'acme-2')
    type('Context length', '')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(injected.submitModel).toHaveBeenCalledWith('llm-pi-ai/acme', expect.not.objectContaining({ contextWindow: 200000 }))
  })

  it('refuses an id the route already configures, and says which one', () => {
    panel(adding())
    type('Model id', 'acme-1')
    expect(screen.getByRole('alert').textContent).toContain('already configures that model id')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true)
  })

  it('refuses a capacity that is not a positive integer', () => {
    panel(adding())
    type('Model id', 'acme-2')
    type('Context length', '-1')
    expect(screen.getByRole('alert').textContent).toContain('positive integer')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true)
  })

  it('says nothing is wrong before an id has been typed', () => {
    panel(adding())
    expect(screen.queryByRole('alert')).toBeNull()
    // The template is filled in already, so only the missing id blocks the write.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add' }).disabled).toBe(true)
  })

  it('closes without writing when cancelled', () => {
    const injected = props(adding())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(injected.cancelAdd).toHaveBeenCalled()
    expect(injected.submitModel).not.toHaveBeenCalled()
  })

  it('reports the entry that was added', () => {
    panel({ ...ready(), notice: { kind: 'added', id: 'acme-2' } })
    expect(screen.getByText('The model acme-2 was added.')).toBeTruthy()
  })
})

/** One entry a fuzzy search offered, with how close it came. */
function similar(
  providerId: string,
  id: string,
  closeness: { readonly similarity: ModelsDevSimilarity; readonly distance?: number },
  published: Record<string, unknown> = {},
): ModelsDevOption {
  return { providerId, ...closeness, model: candidate(providerId, id, published).model }
}

describe('adding a model by fuzzy search', () => {
  afterEach(cleanup)

  it('offers nothing to search for until an id has been typed', () => {
    panel(adding())
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fuzzy search' }).disabled).toBe(true)
    type('Model id', 'acme-2')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fuzzy search' }).disabled).toBe(false)
  })

  it('asks for the close entries without disturbing the id that was typed', () => {
    const injected = props(adding())
    render(<ModelsDevPage {...injected} />)
    type('Model id', 'acme-2')
    fireEvent.click(screen.getByRole('button', { name: 'Fuzzy search' }))
    expect(injected.searchSimilarModels).toHaveBeenCalledWith('llm-pi-ai/acme', 'acme-2')
    expect(injected.searchModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'acme-2')
    expect(field('Model id').value).toBe('acme-2')
  })

  it('names how close each offered entry came', () => {
    panel(adding({
      fuzzy: true,
      modelId: 'acme-2',
      candidates: [
        similar('acme', 'acme-2', { similarity: 'near', distance: 1 }, { contextWindow: 200000 }),
        similar('acme', 'acme-2-pro', { similarity: 'contains' }),
        similar('acme', 'acme-2-20240101', { similarity: 'folded' }),
      ],
    }))
    expect(screen.getByText('3 close entries — choose one')).toBeTruthy()
    expect(screen.getByText(/1 character\(s\) apart/)).toBeTruthy()
    expect(screen.getByText(/one id contains the other/)).toBeTruthy()
    expect(screen.getByText(/identical once folded/)).toBeTruthy()
  })

  it('shows the closeness and the capacities on one line', () => {
    panel(adding({
      fuzzy: true,
      modelId: 'acme-2',
      candidates: [
        similar('acme', 'acme-2', { similarity: 'near', distance: 2 }, { contextWindow: 200000, maxOutputTokens: 8192 }),
        similar('acme', 'acme-3', { similarity: 'near', distance: 1 }),
      ],
    }))
    expect(screen.getByText('2 character(s) apart · 200000 context · 8192 max output')).toBeTruthy()
    // An entry that publishes neither capacity says so rather than inventing one.
    expect(screen.getByText('1 character(s) apart · — context · — max output')).toBeTruthy()
  })

  it('names the closeness of a lone fuzzy answer too', () => {
    panel(adding({
      fuzzy: true,
      modelId: 'acme-2',
      candidates: [similar('acme', 'acme-2', { similarity: 'near', distance: 1 }, { contextWindow: 200000, maxOutputTokens: 8192 })],
    }))
    // A lone fuzzy answer is not adopted silently: the closeness is said out loud
    // and the reader still confirms it.
    expect(screen.getByText('1 character(s) apart')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(field('Context length').value).toBe('200000')
  })

  it('fills the preview from whichever close entry is chosen', () => {
    panel(adding({
      fuzzy: true,
      modelId: 'acme-2',
      candidates: [
        similar('acme', 'acme-2', { similarity: 'near', distance: 1 }, { contextWindow: 200000 }),
        similar('acme', 'acme-3', { similarity: 'near', distance: 2 }, { contextWindow: 64000 }),
      ],
    }))
    expect(field('Context length').value).toBe('131072')
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement)
    expect(field('Context length').value).toBe('64000')
    expect((screen.getAllByRole('radio')[1] as HTMLElement).getAttribute('aria-checked')).toBe('true')
  })

  it('writes the chosen close entry like any other', () => {
    const injected = props(adding({
      fuzzy: true,
      modelId: 'acme-2',
      candidates: [similar('acme', 'acme-2', { similarity: 'near', distance: 1 }, { contextWindow: 200000, maxOutputTokens: 8192, inputModalities: ['text', 'image'] })],
    }))
    render(<ModelsDevPage {...injected} />)
    // The field the reader typed into is the id that gets written, not the one
    // the search happened to be asked about.
    type('Model id', 'acme-2')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(injected.submitModel).toHaveBeenCalledWith('llm-pi-ai/acme', {
      id: 'acme-2',
      name: 'acme-2 name',
      contextWindow: 200000,
      maxTokens: 8192,
      inputModalities: ['text', 'image'],
      modalityField: 'input',
    })
  })

  it('says so when no entry came close, rather than claiming the catalog has none', () => {
    panel(adding({ fuzzy: true, modelId: 'totally-unrelated', candidates: [] }))
    expect(screen.getByText('No entry came close to that id.')).toBeTruthy()
    expect(screen.queryByText(/models\.dev has no matching entry/)).toBeNull()
  })
})
