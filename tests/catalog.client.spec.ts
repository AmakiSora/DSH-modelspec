/**
 * Indexing the models.dev document: a third-party body is validated field by
 * field, an unreadable provider or model is counted rather than fatal, and the
 * published view drops what a deployment cannot configure.
 */

import { describe, expect, it } from 'vitest'
import { catalogView, indexCatalog } from '../src/client/catalog.ts'

const SOURCE = 'https://models.dev/api.json'

/** One wire provider entry with the fields the parser reads. */
function provider(models: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'acme', name: 'Acme', doc: 'https://acme.test/docs', models, ...overrides }
}

/** One wire model entry with the fields the parser reads. */
function model(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acme-1',
    name: 'Acme 1',
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: '2026-01-02',
    modalities: { input: ['text'], output: ['text'] },
    limit: { context: 131072, output: 8192 },
    ...overrides,
  }
}

describe('models.dev catalog indexing', () => {
  it('projects the fields a DSH model row can be configured from', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: provider({
        'acme-1': model({
          description: 'One model.',
          reasoning: true,
          structured_output: true,
          temperature: true,
          status: 'deprecated',
          canonical_model_id: 'acme/acme-1',
          modalities: { input: ['text', 'image', 'audio'] },
          cost: { input: 1, output: 2, cache_read: 0.5 },
        }),
      }),
    })
    expect(index.byProvider.get('acme')).toHaveLength(1)
    expect(index.byProvider.get('acme')?.[0]).toMatchObject({
      canonicalId: 'acme/acme-1',
      view: {
        providerId: 'acme',
        id: 'acme-1',
        name: 'Acme 1',
        description: 'One model.',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        inputModalities: ['text', 'image'],
        reasoning: true,
        toolCall: true,
        structuredOutput: true,
        temperature: true,
        releaseDate: '2026-01-02',
        status: 'deprecated',
        cost: { input: 1, output: 2, cacheRead: 0.5 },
      },
    })
  })

  it('reads a text-only entry as text alone and leaves every unpublished field absent', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: provider({ 'bare': { id: 'bare', name: 'Bare' } }),
    })
    expect(index.byProvider.get('acme')?.[0]?.view).toEqual({
      providerId: 'acme',
      id: 'bare',
      name: 'Bare',
      inputModalities: ['text'],
      reasoning: false,
      toolCall: false,
      structuredOutput: false,
      temperature: false,
    })
  })

  it('drops a capacity or price the document publishes as zero or absent', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: provider({
        zeroed: model({ id: 'zeroed', limit: { context: 0, output: 0 }, cost: {} }),
      }),
    })
    const view = index.byProvider.get('acme')?.[0]?.view
    expect(view?.id).toBe('zeroed')
    expect(view?.contextWindow).toBeUndefined()
    expect(view?.maxOutputTokens).toBeUndefined()
    expect(view?.cost).toBeUndefined()
  })

  it('keeps a fractional price, which the document publishes as often as a whole number', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: provider({ one: model({ cost: { input: 1, output: 2, cache_read: 0.5 } }) }),
    })
    expect(index.byProvider.get('acme')?.[0]?.view.cost).toEqual({ input: 1, output: 2, cacheRead: 0.5 })
  })

  it('counts a provider and a model it could not read instead of failing the document', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: provider({ good: model(), broken: { name: 'no id here' } }),
      broken: 'not a provider object',
    })
    expect(index.providers.map(entry => entry.id)).toEqual(['acme'])
    expect(index.modelCount).toBe(2)
    expect(index.skippedCount).toBe(2)
    expect(index.everyModel).toHaveLength(1)
  })

  it('names a provider after its own id when the document publishes no display name', () => {
    const index = indexCatalog(SOURCE, 1000, {
      acme: { id: 'acme', models: { one: model() } },
    })
    expect(index.providers).toEqual([{ id: 'acme', name: 'acme', modelCount: 1 }])
  })

  it('orders providers by key so two reads of one document index identically', () => {
    const index = indexCatalog(SOURCE, 1000, {
      zeta: provider({ one: model() }, { id: 'zeta' }),
      alpha: provider({ one: model() }, { id: 'alpha' }),
    })
    expect(index.providers.map(entry => entry.id)).toEqual(['alpha', 'zeta'])
    expect([...index.byProvider.keys()]).toEqual(['alpha', 'zeta'])
  })

  it('rejects a body that is not a provider map and one that has no readable provider', () => {
    expect(() => indexCatalog(SOURCE, 1000, [])).toThrow(/not a JSON object/)
    expect(() => indexCatalog(SOURCE, 1000, { acme: 'nope' })).toThrow(/no readable provider/)
  })

  it('projects the address, retrieval time, and counts a consumer renders from', () => {
    const index = indexCatalog(SOURCE, 4242, { acme: provider({ one: model() }) })
    expect(catalogView(index)).toEqual({
      source: SOURCE,
      fetchedAt: 4242,
      providers: [{ id: 'acme', name: 'Acme', doc: 'https://acme.test/docs', modelCount: 1 }],
      modelCount: 1,
      skippedCount: 0,
    })
  })
})
