// @vitest-environment jsdom
/**
 * The models.dev panel with its props supplied directly: the comparison it is
 * handed, the actions it offers, and the diagnostics it reports for every
 * state the Host can leave the panel in.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
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
  picker: null,
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
    pickModel: vi.fn(),
    searchModel: vi.fn(),
    discoverModels: vi.fn(),
    addModel: vi.fn(),
    saveModel: vi.fn(),
    removeModel: vi.fn(),
    cancelPick: vi.fn(),
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
function adding(overrides: Partial<NonNullable<ModelsDevState['picker']>> = {}): ModelsDevState {
  return {
    ...ready(),
    picker: {
      routeKey: 'llm-pi-ai/acme', modelKey: null, modelId: '', fuzzy: false, searching: false,
      candidates: [], error: null, discovering: false, discovered: null, discoverError: null,
      ...overrides,
    },
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

/** One model a route's own endpoint reported about itself. */
function served(id: string, disclosed: Record<string, unknown> = {}): LlmDiscoveredModel {
  return { id, name: id, ...disclosed }
}

/** The entries in the chooser the route's own endpoint answered with. */
function servedChoices(): HTMLElement[] {
  return within(screen.getByRole('radiogroup', { name: /available models/ })).getAllByRole('radio')
}

describe('adding a model', () => {
  afterEach(cleanup)

  it('opens the dialog for the route whose button was pressed', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
    expect(injected.pickModel).toHaveBeenCalledWith('llm-pi-ai/acme', null)
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
    expect(injected.searchModel).toHaveBeenCalledWith('acme-2', false)
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
    expect(injected.addModel).toHaveBeenCalledWith({
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
    expect(injected.addModel).toHaveBeenCalledWith(expect.not.objectContaining({ contextWindow: 200000 }))
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
    expect(injected.cancelPick).toHaveBeenCalled()
    expect(injected.addModel).not.toHaveBeenCalled()
  })

  it('reports the entry that was added', () => {
    panel({ ...ready(), notice: { kind: 'added', id: 'acme-2' } })
    expect(screen.getByText('The model acme-2 was added.')).toBeTruthy()
  })

  it('asks the route which models it serves, and asks nothing by itself', () => {
    const injected = props(adding())
    render(<ModelsDevPage {...injected} />)
    expect(injected.discoverModels).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch available models' }))
    expect(injected.discoverModels).toHaveBeenCalledTimes(1)
  })

  it('says it is asking while the interrogation runs, and refuses a second press', () => {
    panel(adding({ discovering: true }))
    const asking = screen.getByRole<HTMLButtonElement>('button', { name: 'Asking the provider…' })
    expect(asking.disabled).toBe(true)
  })

  it('offers what the endpoint listed, and takes the id the reader chooses', () => {
    const injected = props(adding({ discovered: [served('acme-2'), served('acme-9')] }))
    render(<ModelsDevPage {...injected} />)
    expect(screen.getByText('The provider listed 2 available models — choose a model id')).toBeTruthy()
    fireEvent.click(servedChoices()[1] as HTMLElement)
    // Taking an id asks the catalog the same question typing it would, so the
    // comparison and the fuzzy fallback stay available for the model.
    expect(injected.searchModel).toHaveBeenCalledWith('acme-9', false)
    expect(field('Model id').value).toBe('acme-9')
    expect((servedChoices()[1] as HTMLElement).getAttribute('aria-checked')).toBe('true')
    expect((servedChoices()[0] as HTMLElement).getAttribute('aria-checked')).toBe('false')
  })

  it('fills the fields with what the endpoint disclosed about the chosen model', () => {
    panel(adding({
      discovered: [served('acme-9', {
        name: 'Acme Nine', contextWindow: 200000, maxTokens: 8192, inputModalities: ['text', 'image'],
      })],
    }))
    fireEvent.click(servedChoices()[0] as HTMLElement)
    expect(field('Display name (optional)').value).toBe('Acme Nine')
    expect(field('Context length').value).toBe('200000')
    expect(field('Max output').value).toBe('8192')
    expect((screen.getByLabelText('Accepts image input') as HTMLInputElement).checked).toBe(true)
  })

  it('leaves the fields an endpoint stayed silent about to the adapter', () => {
    // Most listing endpoints disclose an id and nothing else. A name that only
    // repeats the id, and a capacity nobody published, are left empty rather
    // than filled with the route's template or with a guess.
    panel(adding({ discovered: [served('acme-9')] }))
    fireEvent.click(servedChoices()[0] as HTMLElement)
    expect(field('Display name (optional)').value).toBe('')
    expect(field('Context length').value).toBe('')
    expect(field('Max output').value).toBe('')
  })

  it('refills the preview when the same reported model is taken again', () => {
    panel(adding({ discovered: [served('acme-9', { contextWindow: 200000 })] }))
    fireEvent.click(servedChoices()[0] as HTMLElement)
    type('Context length', '999')
    fireEvent.click(servedChoices()[0] as HTMLElement)
    expect(field('Context length').value).toBe('200000')
  })

  it('keeps what the endpoint disclosed until the reader picks a catalog entry', () => {
    panel(adding({
      discovered: [served('acme-9', { contextWindow: 200000 })],
      candidates: [
        candidate('openai', 'acme-9', { contextWindow: 128000 }),
        candidate('azure', 'acme-9', { contextWindow: 64000 }),
      ],
    }))
    fireEvent.click(servedChoices()[0] as HTMLElement)
    expect(field('Context length').value).toBe('200000')
    // The catalog entry is what the row will be compared against, so choosing
    // one replaces the endpoint's own numbers.
    const catalogChoices = within(screen.getByRole('radiogroup', { name: /entries matched/ })).getAllByRole('radio')
    fireEvent.click(catalogChoices[1] as HTMLElement)
    expect(field('Context length').value).toBe('64000')
  })

  it('refuses an id the route already configures, and says so', () => {
    panel(adding({ discovered: [served('acme-1'), served('acme-9')] }))
    expect(screen.getByText('Already configured')).toBeTruthy()
    expect((servedChoices()[0] as HTMLButtonElement).disabled).toBe(true)
    expect((servedChoices()[1] as HTMLButtonElement).disabled).toBe(false)
  })

  it('reports an interrogation the provider refused', () => {
    panel(adding({ discoverError: 'could not reach http://127.0.0.1:5090/v1/models' }))
    expect(screen.getByRole('alert').textContent)
      .toContain('Fetching the available models failed: could not reach http://127.0.0.1:5090/v1/models')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('says the provider listed no models rather than offering an empty list', () => {
    panel(adding({ discovered: [] }))
    expect(screen.getByText('The provider listed no models. Enter the model id by hand.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
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
    expect(injected.searchModel).toHaveBeenCalledWith('acme-2', true)
    expect(injected.searchModel).toHaveBeenCalledWith('acme-2', false)
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
    expect(injected.addModel).toHaveBeenCalledWith({
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

/** The ready state with the picker open on the first route's only model. */
function editing(overrides: Partial<NonNullable<ModelsDevState['picker']>> = {}, row?: Partial<ModelsDevState['routes'][number]['models'][number]>): ModelsDevState {
  const base = readyRoute()
  const model = { ...base.models[0]!, ...row }
  return {
    ...ready(),
    routes: [{ ...base, models: [model] }],
    picker: { routeKey: 'llm-pi-ai/acme', modelKey: 'llm-pi-ai/acme/0', modelId: '', fuzzy: false, searching: false, candidates: [], error: null, ...overrides },
  }
}

describe('editing a configured model', () => {
  afterEach(cleanup)

  it('offers the editor at the right of every model row', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(injected.pickModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
  })

  it('offers no editor for a preset row, or where writes are refused', () => {
    const preset = readyRoute()
    panel(withRoute({ ...preset, route: { ...preset.route, preset: true } }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(true)
    cleanup()
    panel({ ...ready(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(true)
  })

  it('opens on the entry the model follows, not on a sibling template', () => {
    panel(editing())
    expect(screen.getByRole('dialog', { name: 'Edit model configuration' })).toBeTruthy()
    // The entry this model follows is what the picker is about, so its published
    // values are what the editor opens on — the stored ones are one Apply away.
    expect(field('Display name (optional)').value).toBe('acme-1')
    expect(field('Context length').value).toBe('1048576')
    expect(field('Model id').value).toBe('acme-1')
  })

  it('opens on what the model stores when no entry follows it', () => {
    const orphan = readyRoute().models[0]!
    panel(editing({}, {
      model: { ...orphan.model, name: 'Stored Name', contextWindow: 4096, maxTokens: 512 },
      match: { provider: 'acme', modelId: 'acme-1', strategy: 'none' },
      differences: [],
    }))
    // Nothing to adopt, so the only values available are the ones it stores.
    expect(field('Display name (optional)').value).toBe('Stored Name')
    expect(field('Context length').value).toBe('4096')
    expect(field('Max output').value).toBe('512')
  })

  it('says which entry the model follows, and whether the reader chose it', () => {
    panel(editing())
    expect(screen.getByText(/matched from the model id/)).toBeTruthy()
    cleanup()
    const bound = readyRoute().models[0]!
    panel(editing({}, {
      match: { ...bound.match, strategy: 'bound', providerKey: 'azure', model: { ...bound.match.model!, providerId: 'azure' } },
    }))
    expect(screen.getByText(/pinned by you/)).toBeTruthy()
  })

  it('marks a row whose entry was pinned', () => {
    const bound = readyRoute().models[0]!
    panel(withRoute({
      ...readyRoute(),
      models: [{ ...bound, match: { ...bound.match, strategy: 'bound' } }],
    }))
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByText(/the entry you pinned/)).toBeTruthy()
  })

  it('fills the fields from the entry the reader picks instead', () => {
    panel(editing({
      modelId: 'gpt-4o',
      candidates: [
        candidate('openai', 'gpt-4o', { contextWindow: 200000, maxOutputTokens: 8192 }),
        candidate('azure', 'gpt-4o', { contextWindow: 64000 }),
      ],
    }))
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
    expect(field('Context length').value).toBe('200000')
  })

  it('writes the edit and the entry it should follow together', () => {
    const injected = props(editing({
      modelId: 'gpt-4o',
      candidates: [
        candidate('openai', 'gpt-4o', { contextWindow: 200000 }),
        candidate('azure', 'gpt-4o', { contextWindow: 64000 }),
      ],
    }))
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(injected.saveModel).toHaveBeenCalledWith(
      // The chosen entry publishes no output cap, so that field ends up cleared
      // rather than keeping whatever the model stored under it.
      { name: 'gpt-4o name', contextWindow: 64000, inputModalities: ['text'] },
      { providerId: 'azure', modelId: 'gpt-4o' },
    )
  })

  it('keeps following the id when the reader changed no entry', () => {
    const injected = props(editing())
    render(<ModelsDevPage {...injected} />)
    type('Context length', '200000')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // `undefined` is the answer "follow the id again", which is what an edit of
    // a model that was never pinned should leave behind.
    expect(injected.saveModel).toHaveBeenCalledWith(
      expect.objectContaining({ contextWindow: 200000 }),
      undefined,
    )
  })

  it('re-pins the entry the model already followed rather than unpinning it', () => {
    const bound = readyRoute().models[0]!
    const injected = props(editing({}, {
      match: { ...bound.match, strategy: 'bound', providerKey: 'azure', model: { ...bound.match.model!, providerId: 'azure' } },
    }))
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // Editing the values of a pinned model must not silently unpin it.
    expect(injected.saveModel).toHaveBeenCalledWith(
      expect.anything(),
      { providerId: 'azure', modelId: 'acme-1' },
    )
  })

  it('closes without writing when cancelled', () => {
    const injected = props(editing())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(injected.cancelPick).toHaveBeenCalled()
    expect(injected.saveModel).not.toHaveBeenCalled()
  })

  it('reports the edit that was saved', () => {
    panel({ ...ready(), notice: { kind: 'saved' } })
    expect(screen.getByText('The model configuration was updated.')).toBeTruthy()
  })
})

/** The ready state with two models on the first route. */
function twoModels(): ModelsDevState {
  const route = readyRoute()
  const first = route.models[0]!
  const second: typeof first = { ...first, key: 'llm-pi-ai/acme/1', model: { ...first.model, index: 1, id: 'acme-2' } }
  return { ...ready(), routes: [{ ...route, route: { ...route.route, arrayLength: 2 }, models: [first, second] }] }
}

/** The confirm button inside the removal dialog, which shares the row's name. */
function confirm(): HTMLElement {
  return within(screen.getByRole('dialog', { name: 'Remove model' }))
    .getByRole('button', { name: 'Remove' })
}

describe('removing a configured model', () => {
  afterEach(cleanup)

  it('asks before it removes anything', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(injected.removeModel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Remove model' })).toBeTruthy()
  })

  it('names the model and the provider it would be taken out of', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const description = screen.getByRole('dialog', { name: 'Remove model' }).textContent
    expect(description).toContain('acme-1')
    expect(description).toContain('Acme')
  })

  it('warns that removing the only model takes the whole provider off the panel', () => {
    panel(ready())
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText(/stop appearing on the panel/)).toBeTruthy()
    expect(screen.queryByText(/shift forward/)).toBeNull()
  })

  it('says the models behind it shift, when the route keeps others', () => {
    panel(twoModels())
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement)
    expect(screen.getByText(/shift forward/)).toBeTruthy()
    expect(screen.queryByText(/stop appearing on the panel/)).toBeNull()
  })

  it('removes the model the reader confirmed, and nothing else', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(confirm())
    expect(injected.removeModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/0')
    expect(injected.removeModel).toHaveBeenCalledTimes(1)
  })

  it('removes the right one of two, whichever row was pressed', () => {
    const injected = props(twoModels())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement)
    fireEvent.click(confirm())
    expect(injected.removeModel).toHaveBeenCalledWith('llm-pi-ai/acme', 'llm-pi-ai/acme/1')
  })

  it('removes nothing when the reader backs out', () => {
    const injected = props(ready())
    render(<ModelsDevPage {...injected} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(injected.removeModel).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Remove model' })).toBeNull()
  })

  it('offers no removal for a preset row, or where writes are refused', () => {
    const preset = readyRoute()
    panel(withRoute({ ...preset, route: { ...preset.route, preset: true } }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true)
    cleanup()
    panel({ ...ready(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true)
  })

  it('offers no removal while a write is in flight', () => {
    panel({ ...ready(), writing: ['llm-pi-ai'] })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true)
  })

  it('reports the model that was removed', () => {
    panel({ ...ready(), notice: { kind: 'removed', id: 'acme-1' } })
    expect(screen.getByText('The model acme-1 was removed.')).toBeTruthy()
  })
})
