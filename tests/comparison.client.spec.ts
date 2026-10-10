/**
 * Comparing a configured model with its catalog entry, and turning the
 * differences into the edits that adopt them. Only a published value is
 * writable, and the edit addresses the route's own settings path.
 */

import { describe, expect, it } from 'vitest'
import type { ModelsDevMatch, ModelsDevModel } from '../src/client/types.ts'
import { applyOps, compareModel, isModalityDifference } from '../src/client/comparison.ts'
import type { ConfiguredModel, ConfiguredRoute } from '../src/client/configured.ts'

/** One configured model entry. */
function model(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return { index: 2, id: 'acme-1', inputModalities: ['text'], modalityField: 'input', ...overrides }
}

/** One configured route. */
function route(overrides: Partial<ConfiguredRoute> = {}): ConfiguredRoute {
  return {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    displayName: 'Acme',
    settingsPath: ['providers', 'acme'],
    revision: 7,
    preset: false,
    models: [],
    ...overrides,
  }
}

/** One catalog entry as the Remote publishes it. */
function entry(overrides: Partial<ModelsDevModel> = {}): ModelsDevModel {
  return {
    providerId: 'acme',
    id: 'acme-1',
    name: 'Acme 1',
    inputModalities: ['text'],
    reasoning: false,
    toolCall: true,
    structuredOutput: false,
    temperature: true,
    ...overrides,
  }
}

/** One catalog answer carrying the given entry. */
function match(model?: ModelsDevModel): ModelsDevMatch {
  return model === undefined
    ? { provider: 'acme', modelId: 'acme-1', strategy: 'none' }
    : { provider: 'acme', modelId: 'acme-1', routeProviderKey: 'acme', providerKey: 'acme', strategy: 'exact', model }
}

describe('model comparison', () => {
  it('reports nothing for an id the catalog does not publish', () => {
    expect(compareModel(model(), match())).toEqual([])
  })

  it('reports a capacity the catalog publishes and the deployment stores differently', () => {
    expect(compareModel(model({ contextWindow: 131072 }), match(entry({ contextWindow: 1048576 })))).toEqual([
      { field: 'contextWindow', configured: 131072, published: 1048576 },
    ])
    expect(compareModel(model({ maxTokens: 8192 }), match(entry({ maxOutputTokens: 32768 })))).toEqual([
      { field: 'maxTokens', configured: 8192, published: 32768 },
    ])
  })

  it('reports an unset capacity the catalog publishes, so adopting it sets one', () => {
    expect(compareModel(model(), match(entry({ contextWindow: 262144, maxOutputTokens: 8192 })))).toEqual([
      { field: 'contextWindow', configured: undefined, published: 262144 },
      { field: 'maxTokens', configured: undefined, published: 8192 },
    ])
  })

  it('leaves a capacity alone when the catalog publishes none', () => {
    expect(compareModel(model({ contextWindow: 131072 }), match(entry()))).toEqual([])
  })

  it('compares modalities as sets, so order alone is not a difference', () => {
    expect(compareModel(model({ inputModalities: ['text'] }), match(entry({ inputModalities: ['text'] })))).toEqual([])
    expect(compareModel(model({ inputModalities: [] }), match(entry({ inputModalities: ['text'] })))).toEqual([
      { field: 'input', configured: [], published: ['text'] },
    ])
    expect(compareModel(model({ inputModalities: ['text', 'image'] }), match(entry({ inputModalities: ['image', 'text'] })))).toEqual([])
  })

  it('addresses the modality field the Messages adapter declares', () => {
    const differences = compareModel(
      model({ modalityField: 'inputModalities' }),
      match(entry({ inputModalities: ['text', 'image'] })),
    )
    expect(differences).toEqual([{ field: 'inputModalities', configured: ['text'], published: ['text', 'image'] }])
  })

  it('offers no modality difference for an entry that declares no modality field', () => {
    const bare = { index: 0, id: 'acme-1', inputModalities: [] } as ConfiguredModel
    expect(compareModel(bare, match(entry({ inputModalities: ['text', 'image'] })))).toEqual([])
  })

  it('names both modality spellings as a modality difference and neither capacity as one', () => {
    expect(isModalityDifference({ field: 'input', configured: [], published: ['text'] })).toBe(true)
    expect(isModalityDifference({ field: 'inputModalities', configured: [], published: ['text'] })).toBe(true)
    expect(isModalityDifference({ field: 'contextWindow', configured: 1, published: 2 })).toBe(false)
    expect(isModalityDifference({ field: 'maxTokens', configured: 1, published: 2 })).toBe(false)
  })
})

describe('adoption edits', () => {
  it('addresses each difference under the route path and the model index', () => {
    const configured = model({ contextWindow: 131072, inputModalities: ['text'] })
    const differences = compareModel(configured, match(entry({ contextWindow: 1048576, inputModalities: ['text', 'image'] })))
    expect(applyOps(route(), configured, differences)).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'contextWindow'], value: 1048576 },
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'input'], value: ['text', 'image'] },
    ])
  })

  it('addresses a Messages route whose whole section is the profile', () => {
    const configured = model({ modalityField: 'inputModalities' })
    const differences = compareModel(configured, match(entry({ maxOutputTokens: 8192 })))
    expect(applyOps(route({ settingsNs: 'llm-deepseek', settingsPath: [] }), configured, differences)).toEqual([
      { op: 'set', path: ['models', '2', 'maxTokens'], value: 8192 },
    ])
  })

  it('copies the published modalities rather than sharing the array the row holds', () => {
    const configured = model()
    const published = entry({ inputModalities: ['text', 'image'] })
    const [first] = applyOps(route(), configured, compareModel(configured, match(published)))
    if (first?.op !== 'set') throw new Error('a modality difference must be written as a set')
    expect(first.value).toEqual(['text', 'image'])
    expect(first.value).not.toBe(published.inputModalities)
  })

  it('writes nothing when there is nothing to adopt', () => {
    expect(applyOps(route(), model(), [])).toEqual([])
  })
})
