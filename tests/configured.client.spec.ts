/**
 * Reading the configured routes: the provider directory plus the redacted
 * settings namespaces produce one row per route, with the model array located
 * through the route's own settings path.
 */

import { describe, expect, it } from 'vitest'
import type { LlmConfigurableProvider, SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { readRoutes } from '../src/client/configured.ts'

/** One directory entry for a route the deployment declared. */
function entry(overrides: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider {
  return {
    provider: 'acme',
    displayName: 'Acme',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'acme'],
    declared: true,
    ...overrides,
  }
}

/** One redacted namespace view carrying the given resolved section. */
function view(ns: string, value: JsonValue, overrides: Partial<SettingsNamespaceView> = {}): SettingsNamespaceView {
  return {
    ns,
    autoGenerate: true,
    schema: {},
    value,
    applies: 'live',
    secrets: [],
    revision: 7,
    ...overrides,
  }
}

/** Wrap section values in the describe() envelope the panel reads. */
function described(namespaces: readonly SettingsNamespaceView[]): SettingsDescribeValue {
  return { writable: true, hasDocument: true, namespaces: [...namespaces] }
}

describe('configured routes', () => {
  it('reads a pi-ai route profile through its settings path', () => {
    const routes = readRoutes([entry()], described([view('llm-pi-ai', {
      providers: { acme: { models: [{ id: 'acme-1', contextWindow: 131072, input: ['text', 'image'] }] } },
    })]))
    expect(routes).toEqual([{
      settingsNs: 'llm-pi-ai',
      provider: 'acme',
      displayName: 'Acme',
      settingsPath: ['providers', 'acme'],
      revision: 7,
      arrayLength: 1,
      preset: false,
      models: [{
        index: 0,
        id: 'acme-1',
        contextWindow: 131072,
        inputModalities: ['text', 'image'],
        modalityField: 'input',
      }],
    }])
  })

  it('reports the array length the namespace holds, entries it could not read included', () => {
    // An entry with no readable id still occupies an index, so the count the
    // panel shows is not the address a new model has to be appended at.
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'a' }, { limit: { context: 1 } }, { id: '' }, { id: 'b' }] }),
    ]))
    expect(routes[0]?.models.map(model => model.id)).toEqual(['a', 'b'])
    expect(routes[0]?.arrayLength).toBe(4)
  })

  it('appends to the user layer array even when the resolved one is longer', () => {
    // The rows still come from the resolved value — that is what the deployment
    // runs with — but an edit lands on the user section and is merged over the
    // resolved one, so the index has to be one the user array actually has.
    // The nested path is the pi-ai shape, where the profile sits under a route key.
    const routes = readRoutes([entry()], described([
      {
        ...view('llm-pi-ai', { providers: { acme: { models: [{ id: 'from-base' }, { id: 'user-1' }] } } }),
        user: { providers: { acme: { models: [{ id: 'user-1' }] } } },
      },
    ]))
    expect(routes[0]?.models.map(model => model.id)).toEqual(['from-base', 'user-1'])
    expect(routes[0]?.arrayLength).toBe(1)
  })

  it('falls back to the resolved length when the user layer stores no models there', () => {
    const routes = readRoutes([entry()], described([
      {
        ...view('llm-pi-ai', { providers: { acme: { models: [{ id: 'a' }, { id: 'b' }] } } }),
        // The user layer describes a different route entirely.
        user: { providers: { other: { models: [] } } },
      },
    ]))
    expect(routes[0]?.arrayLength).toBe(2)
  })

  it('falls back to the resolved length when the namespace has no user section', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'a' }] }),
    ]))
    expect(routes[0]?.arrayLength).toBe(1)
  })

  it('reads a Messages route whose whole section is the profile', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text'] }] }),
    ]))
    expect(routes[0]?.models).toEqual([
      { index: 0, id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text'], modalityField: 'inputModalities' },
    ])
  })

  it('keeps every configured model in array order with its write address', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    ]))
    expect(routes[0]?.models.map(model => [model.index, model.id])).toEqual([[0, 'a'], [1, 'b'], [2, 'c']])
  })

  it('drops a capacity that is absent, zero, fractional, or negative', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', {
        models: [
          { id: 'zero', contextWindow: 0, maxTokens: -1, inputModalities: ['text'] },
          { id: 'fraction', contextWindow: 1.5, maxTokens: 1024, inputModalities: ['text'] },
        ],
      }),
    ]))
    expect(routes[0]?.models[0]).toMatchObject({ id: 'zero', inputModalities: ['text'] })
    expect(routes[0]?.models[0]?.contextWindow).toBeUndefined()
    expect(routes[0]?.models[0]?.maxTokens).toBeUndefined()
    expect(routes[0]?.models[1]).toMatchObject({ id: 'fraction', maxTokens: 1024 })
    expect(routes[0]?.models[1]?.contextWindow).toBeUndefined()
  })

  it('keeps only the modalities a DSH model entry can declare', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'odd', inputModalities: ['text', 'audio', 'image'] }] }),
    ]))
    expect(routes[0]?.models[0]?.inputModalities).toEqual(['text', 'image'])
  })

  it('offers no modality field for an entry that declares neither one', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'bare' }] }),
    ]))
    expect(routes[0]?.models[0]).toEqual({ index: 0, id: 'bare', inputModalities: [] })
  })

  it('skips an entry with no usable model id and keeps its array position', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: '' }, { id: 'kept' }, { name: 'no id' }] }),
    ]))
    expect(routes[0]?.models).toEqual([{ index: 1, id: 'kept', inputModalities: [] }])
  })

  it('leaves out a route whose settings namespace was never declared', () => {
    const routes = readRoutes([entry(), entry({ provider: 'other', settingsNs: 'llm-absent' })], described([
      view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', input: ['text'] }] } } }),
    ]))
    expect(routes.map(route => route.provider)).toEqual(['acme'])
  })

  it('leaves out a route whose settings path resolves no profile', () => {
    const routes = readRoutes([entry()], described([view('llm-pi-ai', { providers: {} })]))
    expect(routes).toEqual([])
  })

  it('leaves out a route that declares no models, which is every dormant catalog route', () => {
    const directory = [
      entry(),
      ...Array.from({ length: 40 }, (_unused, index) =>
        entry({ provider: `route-${index}`, settingsPath: ['providers', `route-${index}`] })),
    ]
    const routes = readRoutes(directory, described([
      view('llm-pi-ai', { providers: { acme: { models: [{ id: 'acme-1', input: ['text'] }] } } }),
    ]))
    expect(routes.map(route => route.provider)).toEqual(['acme'])
  })

  it('carries the configuration diagnostic the directory reports', () => {
    const routes = readRoutes([entry({ error: 'model "m" contextWindow must be a positive integer' })], described([
      view('llm-pi-ai', { providers: { acme: { models: [{ id: 'm' }] } } }),
    ]))
    expect(routes[0]?.error).toBe('model "m" contextWindow must be a positive integer')
  })

  it('ignores a display name that is present but empty', () => {
    const routes = readRoutes([entry({ settingsNs: 'llm-deepseek', settingsPath: [] })], described([
      view('llm-deepseek', { models: [{ id: 'a', name: '' }] }),
    ]))
    expect(routes[0]?.models[0]).not.toHaveProperty('name')
  })

  it('marks only a configuration-declared route as writable, and every other one a preset', () => {
    const section = { models: [{ id: 'a' }] }
    const routes = readRoutes([
      entry({ provider: 'declared', settingsNs: 'llm-pi-ai', settingsPath: [], declared: true }),
      entry({ provider: 'shipped', settingsNs: 'llm-deepseek-api-key', settingsPath: [], declared: false }),
      // The native DeepSeek adapters register their two routes with no
      // `declared` answer at all, so the field is genuinely absent here.
      { provider: 'undistinguished', displayName: 'DeepSeek Account', settingsNs: 'llm-deepseek-account', settingsPath: [] },
    ], described([
      view('llm-pi-ai', section),
      view('llm-deepseek-api-key', section),
      view('llm-deepseek-account', section),
    ]))
    expect(routes.map(route => [route.provider, route.preset])).toEqual([
      ['declared', false], ['shipped', true], ['undistinguished', true],
    ])
  })
})
