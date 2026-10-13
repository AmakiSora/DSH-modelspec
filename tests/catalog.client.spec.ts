/**
 * Indexing the catalog document: a third-party body is validated field by
 * field, an unreadable model entry is counted rather than fatal, and the
 * published view drops what a deployment cannot configure.
 */

import { describe, expect, it } from 'vitest'
import { catalogView, declaredEffortsOf, indexCatalog } from '../src/client/catalog.ts'

const SOURCE = 'https://openrouter.ai/api/v1/models'

/** One wire model entry with the fields the parser reads. */
function model(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acme/acme-1',
    name: 'Acme 1',
    created: 1767225600,
    context_length: 131072,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    top_provider: { max_completion_tokens: 8192 },
    supported_parameters: ['tools', 'temperature'],
    ...overrides,
  }
}

/** The document envelope the endpoint publishes. */
function document(models: unknown[]): Record<string, unknown> {
  return { data: models }
}

describe('catalog indexing', () => {
  it('projects the fields a DSH model row can be configured from', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model({
        description: 'One model.',
        architecture: { input_modalities: ['text', 'image', 'audio'] },
        supported_parameters: ['tools', 'structured_outputs', 'temperature', 'reasoning_effort'],
        pricing: { prompt: '0.000001', completion: '0.000002', input_cache_read: '0.0000005' },
        reasoning: { mandatory: false, supported_efforts: ['max', 'high', 'low', 'none'], default_effort: 'high' },
      }),
    ]))
    expect(index.byProvider.get('acme')).toHaveLength(1)
    expect(index.byProvider.get('acme')?.[0]).toMatchObject({
      view: {
        providerId: 'acme',
        id: 'acme/acme-1',
        name: 'Acme 1',
        description: 'One model.',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        inputModalities: ['text', 'image'],
        reasoning: true,
        reasoningEfforts: { efforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high' },
        declaredEfforts: { off: null, max: 'max', high: 'high', low: 'low' },
        toolCall: true,
        structuredOutput: true,
        temperature: true,
        releaseDate: '2026-01-01',
        cost: { input: 1, output: 2, cacheRead: 0.5 },
      },
    })
  })

  it('groups entries by the vendor prefix of the id, and unprefixed ones under the direct key', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model({ id: 'openai/gpt-x' }),
      model({ id: 'anthropic/claude-x' }),
      model({ id: 'bare-model' }),
    ]))
    expect([...index.byProvider.keys()].sort()).toEqual(['(direct)', 'anthropic', 'openai'])
    expect(index.providers.map(provider => provider.id).sort())
      .toEqual(['(direct)', 'anthropic', 'openai'])
  })

  it('reads a text-only entry as text alone and leaves every unpublished field absent', () => {
    const index = indexCatalog(SOURCE, 1000, document([{ id: 'acme/bare', name: 'Bare' }]))
    expect(index.byProvider.get('acme')?.[0]?.view).toEqual({
      providerId: 'acme',
      id: 'acme/bare',
      name: 'Bare',
      inputModalities: ['text'],
      reasoning: false,
      toolCall: false,
      structuredOutput: false,
      temperature: false,
    })
  })

  it('drops a capacity or price the document publishes as zero or absent', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model({ id: 'acme/zeroed', context_length: 0, top_provider: { max_completion_tokens: 0 }, pricing: {} }),
    ]))
    const view = index.byProvider.get('acme')?.[0]?.view
    expect(view?.id).toBe('acme/zeroed')
    expect(view?.contextWindow).toBeUndefined()
    expect(view?.maxOutputTokens).toBeUndefined()
    expect(view?.cost).toBeUndefined()
  })

  it('keeps a fractional price, which the document publishes per token', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model({ pricing: { prompt: '0.00000068', completion: '0.00000209', input_cache_read: '0.00000007' } }),
    ]))
    expect(index.byProvider.get('acme')?.[0]?.view.cost).toEqual({
      input: 0.68, output: 2.09, cacheRead: 0.07,
    })
  })

  it('counts a model it could not read instead of failing the document', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model(),
      { name: 'no id here' },
    ]))
    expect(index.providers.map(entry => entry.id)).toEqual(['acme'])
    expect(index.modelCount).toBe(2)
    expect(index.skippedCount).toBe(1)
    expect(index.everyModel).toHaveLength(1)
  })

  it('orders providers and entries by key so two reads of one document index identically', () => {
    const index = indexCatalog(SOURCE, 1000, document([
      model({ id: 'zeta/one' }),
      model({ id: 'alpha/one' }),
      model({ id: 'alpha/two' }),
    ]))
    expect(index.providers.map(entry => entry.id)).toEqual(['alpha', 'zeta'])
    expect([...index.byProvider.keys()]).toEqual(['alpha', 'zeta'])
    expect(index.byProvider.get('alpha')?.map(entry => entry.view.id)).toEqual(['alpha/one', 'alpha/two'])
  })

  it('rejects a body that is not the envelope and one that publishes no readable model', () => {
    expect(() => indexCatalog(SOURCE, 1000, [])).toThrow(/not a JSON object/)
    expect(() => indexCatalog(SOURCE, 1000, {})).toThrow(/no model array/)
    expect(() => indexCatalog(SOURCE, 1000, document([{ name: 'no id' }]))).toThrow(/no readable model/)
  })

  it('projects the address, retrieval time, and counts a consumer renders from', () => {
    const index = indexCatalog(SOURCE, 4242, document([model()]))
    expect(catalogView(index)).toEqual({
      source: SOURCE,
      fetchedAt: 4242,
      providers: [{ id: 'acme', name: 'acme', modelCount: 1 }],
      modelCount: 1,
      skippedCount: 0,
    })
  })

  it('translates the published efforts into the dict a model entry declares', () => {
    // `none` is the off level's no-parameter spelling; an entry publishing only
    // `none` declares nothing, because an off-only dict is one resolution refuses.
    expect(declaredEffortsOf({ efforts: ['max', 'high', 'none'] })).toEqual({
      off: null, max: 'max', high: 'high',
    })
    expect(declaredEffortsOf({ efforts: ['none'] })).toBeUndefined()
    expect(declaredEffortsOf(undefined)).toBeUndefined()
  })
})
