/**
 * Locating a configured route and model in the catalog: the provider
 * resolution order, the model comparisons, and the fact that an unmatched
 * provider falls back to a whole-document search.
 *
 * The document is the one OpenRouter publishes: every id carries its vendor
 * prefix, and the index groups entries by that prefix. A deployment route
 * whose ids are bare reaches its entry through the bare comparison, which is
 * the ordinary gateway case.
 */

import { describe, expect, it } from 'vitest'
import { indexCatalog } from '../src/client/catalog.ts'
import { matchBound, matchCandidates, matchModel, resolveProviderKey, similarCandidates } from '../src/client/match.ts'

/**
 * Index one small catalog with the given providers and models. Each provider
 * becomes a vendor prefix: the model id the document publishes is
 * `<provider>/<model>`, which is what the index groups the entries by.
 */
function indexOf(providers: Record<string, Record<string, Record<string, unknown>>>): ReturnType<typeof indexCatalog> {
  return indexCatalog('https://openrouter.ai/api/v1/models', 1000, {
    data: Object.entries(providers).flatMap(([key, models]) =>
      Object.values(models).map(model => ({ ...model, id: `${key}/${model['id'] as string}` }))),
  })
}

/** One wire model entry that carries only an id and a name. */
function entry(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, architecture: { input_modalities: ['text'] }, ...extra }
}

describe('provider resolution', () => {
  const index = indexOf({
    openai: { 'gpt-4o': entry('gpt-4o') },
    'cloudflare-ai-gateway': { 'llama': entry('llama') },
    deepseek: { 'deepseek-chat': entry('deepseek-chat') },
    google: { 'gemini-2.5-pro': entry('gemini-2.5-pro') },
  })

  it('folds case and `_` onto the `-` a provider key uses', () => {
    expect(resolveProviderKey(index, 'openai', {})).toBe('openai')
    expect(resolveProviderKey(index, 'OpenAI', {})).toBe('openai')
    expect(resolveProviderKey(index, 'cloudflare_ai_gateway', {})).toBe('cloudflare-ai-gateway')
  })

  it('takes a configured alias before any segment rule', () => {
    expect(resolveProviderKey(index, 'my-gateway', { 'my-gateway': 'OpenAI' })).toBe('openai')
    expect(resolveProviderKey(index, 'my-gateway', { 'my-gateway': 'nothing-here' })).toBeUndefined()
  })

  it('drops leading segments, then trailing ones, so either spelling of a route resolves', () => {
    expect(resolveProviderKey(index, 'openai-compatible', {})).toBe('openai')
    expect(resolveProviderKey(index, 'deepseek-official', {})).toBe('deepseek')
    expect(resolveProviderKey(index, 'google-gemini', {})).toBe('google')
  })

  it('answers nothing for a route no provider and no segment names', () => {
    expect(resolveProviderKey(index, 'my-gateway', {})).toBeUndefined()
    expect(resolveProviderKey(index, '   ', {})).toBeUndefined()
  })
})

describe('model matching', () => {
  const index = indexOf({
    openai: {
      'gpt-4o': entry('gpt-4o'),
      'gpt-4o-mini': entry('gpt-4o-mini'),
    },
    anthropic: {
      'claude-opus-4-7': entry('claude-opus-4-7'),
      'claude-opus-4-7-20260101': entry('claude-opus-4-7-20260101'),
    },
  })

  it('prefers the identical id inside the resolved provider', () => {
    const match = matchModel(index, 'openai', 'openai/gpt-4o', {})
    expect(match).toMatchObject({ routeProviderKey: 'openai', providerKey: 'openai', strategy: 'exact' })
    expect(match.model?.id).toBe('openai/gpt-4o')
  })

  it('reads a bare gateway id through the vendor prefix it drops', () => {
    expect(matchModel(index, 'openai', 'gpt-4o', {})).toMatchObject({ strategy: 'bare', providerKey: 'openai' })
    // Without a resolved provider the bare comparison is not offered, but the
    // folded one still is — precise enough, because folding keeps the whole id.
    expect(matchModel(index, 'my-gateway', 'gpt-4o', {})).toMatchObject({ strategy: 'normalized', providerKey: 'openai' })
  })

  it('folds case, punctuation, and a trailing release date', () => {
    expect(matchModel(index, 'anthropic', 'Claude Opus 4 7', {})).toMatchObject({ strategy: 'normalized' })
    expect(matchModel(index, 'anthropic', 'claude-opus-4-7-20260101', {})).toMatchObject({ strategy: 'bare' })
  })

  it('searches the whole document when the resolved provider publishes no such id', () => {
    const match = matchModel(index, 'anthropic', 'openai/gpt-4o', {})
    expect(match).toMatchObject({ routeProviderKey: 'anthropic', providerKey: 'openai', strategy: 'exact' })
  })

  it('reports no provider key and no entry when nothing in the document answers', () => {
    expect(matchModel(index, 'anthropic', 'nothing-like-this', {})).toEqual({
      provider: 'anthropic',
      modelId: 'nothing-like-this',
      routeProviderKey: 'anthropic',
      strategy: 'none',
    })
    expect(matchModel(index, 'my-gateway', 'nothing-like-this', {})).toEqual({
      provider: 'my-gateway',
      modelId: 'nothing-like-this',
      strategy: 'none',
    })
  })
})

describe('candidate matching', () => {
  const index = indexOf({
    openai: {
      'gpt-4o': entry('gpt-4o', { context_length: 128000, top_provider: { max_completion_tokens: 16384 } }),
      'gpt-4o-mini': entry('gpt-4o-mini'),
    },
    azure: { 'gpt-4o': entry('gpt-4o', { context_length: 128000 }) },
    anthropic: {
      'claude-opus-4-7': entry('claude-opus-4-7'),
      'claude-opus-4-7-20260101': entry('claude-opus-4-7-20260101'),
    },
  })

  it('answers with the single entry the resolved provider publishes', () => {
    expect(matchCandidates(index, 'openai', 'openai/gpt-4o-mini', {})).toMatchObject([
      { providerId: 'openai', strategy: 'exact' },
    ])
    expect(matchCandidates(index, 'openai', 'openai/gpt-4o-mini', {})[0]?.model.id).toBe('openai/gpt-4o-mini')
  })

  it('keeps a resolved provider to its own entry for an id it publishes', () => {
    // `azure` publishes the same id, but the route resolved to `openai`, so
    // offering the other provider's entry would invite the wrong pick.
    expect(matchCandidates(index, 'openai', 'openai/gpt-4o', {}).map(candidate => candidate.providerId))
      .toEqual(['openai'])
  })

  it('offers every provider publishing the id when the route resolves to none', () => {
    // A gateway names no catalog provider of its own, so the id is genuinely
    // ambiguous and every publisher has to reach the reader.
    expect(matchCandidates(index, 'my-gateway', 'gpt-4o', {}).map(candidate => candidate.providerId).sort())
      .toEqual(['azure', 'openai'])
  })

  it('keeps the comparison a single match would have reported', () => {
    const [candidate] = matchCandidates(index, 'azure', 'azure/gpt-4o', {})
    expect(candidate).toMatchObject({ strategy: 'exact' })
    expect(candidate?.model.contextWindow).toBe(128000)
    // `openai`'s entry publishes an output cap the Azure one does not, so the
    // ambiguity is real and both entries are worth choosing between.
    expect(matchCandidates(index, 'my-gateway', 'gpt-4o', {}).map(candidate => candidate.model.maxOutputTokens).sort())
      .toEqual([16384, undefined])
  })

  it('collects every entry one comparison accepts rather than only the first', () => {
    // Both dated and undated fold onto `claude-opus-4-7`, so the folded
    // comparison accepts both and the reader chooses between them.
    const candidates = matchCandidates(index, 'anthropic', 'Claude Opus 4 7', {})
    expect(candidates.map(candidate => candidate.model.id)).toEqual([
      'anthropic/claude-opus-4-7', 'anthropic/claude-opus-4-7-20260101',
    ])
    expect(candidates[0]?.strategy).toBe('normalized')
  })

  it('stops at the precise comparison instead of widening with a looser one', () => {
    // A bare hit elsewhere has to win before any folded comparison is offered.
    expect(matchCandidates(index, 'openai', 'azure/gpt-4o', {}).every(candidate => candidate.strategy === 'exact')).toBe(true)
  })

  it('answers with nothing when no comparison accepts the id', () => {
    expect(matchCandidates(index, 'openai', 'nothing-like-this', {})).toEqual([])
    expect(matchCandidates(index, 'my-gateway', '', {})).toEqual([])
  })
})

describe('fuzzy matching', () => {
  const index = indexOf({
    openai: {
      'gpt-4o': entry('gpt-4o', { context_length: 128000 }),
      'gpt-4o-mini': entry('gpt-4o-mini'),
      'gpt-5': entry('gpt-5'),
      'o3-mini': entry('o3-mini'),
    },
    azure: { 'gpt-4o': entry('gpt-4o', { context_length: 128000 }) },
    anthropic: {
      'claude-opus-4-7': entry('claude-opus-4-7'),
      'claude-sonnet-4-5': entry('claude-sonnet-4-5'),
    },
  })

  it('finds an entry one character away', () => {
    // The whole point of the search: `gpt-4o` mistyped as `gpt-4p` reaches the
    // entry no comparison would answer for. `gpt-5` is two edits away, past the
    // budget a six-character id gets, so it is not offered either.
    expect(matchCandidates(index, 'openai', 'gpt-4p', {})).toEqual([])
    const similar = similarCandidates(index, 'openai', 'gpt-4p', {})
    expect(similar).toHaveLength(2)
    expect(similar[0]).toMatchObject({ providerId: 'openai', similarity: 'near', distance: 1, model: { id: 'openai/gpt-4o' } })
    expect(similar.map(hit => hit.model.id)).not.toContain('openai/gpt-5')
  })

  it('counts a dropped separator as one edit rather than folding it away', () => {
    // `gpt4o` and `gpt-4o` differ by the hyphen `normalizeId` inserts, so the
    // closeness is a counted edit rather than the folded match an equal id gets.
    expect(similarCandidates(index, 'openai', 'GPT4O', {})[0])
      .toMatchObject({ similarity: 'near', distance: 1, model: { id: 'openai/gpt-4o' } })
    expect(similarCandidates(index, 'openai', 'gpt4o', {})[0])
      .toMatchObject({ similarity: 'near', distance: 1, model: { id: 'openai/gpt-4o' } })
  })

  it('treats a one-id-containing-the-other as its own kind of closeness', () => {
    // A truncation is not a typo, so it is named rather than counted in edits.
    const similar = similarCandidates(index, 'openai', 'gpt-4o', {})
    expect(similar.map(hit => [hit.model.id, hit.similarity])).toContainEqual(['openai/gpt-4o-mini', 'contains'])
    expect(similar.find(hit => hit.model.id === 'openai/gpt-4o')).toMatchObject({ similarity: 'folded' })
  })

  it('ranks a folded answer above a containment, and the route provider above the rest', () => {
    const similar = similarCandidates(index, 'openai', 'gpt-4o', {})
    // Two providers publish this id and both fold to it, so the route's own
    // provider leads and the other follows before anything looser.
    expect(similar.map(hit => [hit.similarity, hit.providerId])).toEqual([
      ['folded', 'openai'],
      ['folded', 'azure'],
      ['contains', 'openai'],
    ])
  })

  it('prefers the route resolved provider when two entries are equally close', () => {
    // `azure` publishes the same id, so only the route's own provider settles it.
    const similar = similarCandidates(index, 'azure', 'gpt-4p', {})
    expect(similar[0]).toMatchObject({ providerId: 'azure', similarity: 'near', distance: 1 })
  })

  it('keeps the containment answer a truncation gets, whatever the budget', () => {
    // A truncated paste is the case the button is for, and containment names it
    // as such rather than counting the characters a suffix would have added.
    expect(similarCandidates(index, 'anthropic', 'claude-sonnet-4', {})).toMatchObject([
      { similarity: 'contains', model: { id: 'anthropic/claude-sonnet-4-5' } },
    ])
  })

  it('widens the edit budget as the id gets longer', () => {
    // One typo is always in reach; the second only once the id is long enough
    // that two wrong characters still say something about it.
    expect(similarCandidates(index, 'openai', 'gpt-4p', {}).map(hit => hit.model.id)).not.toContain('openai/gpt-5')
    expect(similarCandidates(index, 'openai', 'gpt-4o-mini-x', {}).map(hit => hit.model.id)).toContain('openai/gpt-4o-mini')
  })

  it('offers an id too short to search for nothing beyond containment', () => {
    // One edit on a four-character id would reach most of the document, so the
    // shortest ids get containment only.
    expect(similarCandidates(index, 'openai', 'gpt4', {}).every(hit => hit.similarity === 'contains')).toBe(true)
  })

  it('answers with nothing for an empty id or one no entry resembles', () => {
    expect(similarCandidates(index, 'openai', '', {})).toEqual([])
    expect(similarCandidates(index, 'openai', '   ', {})).toEqual([])
    expect(similarCandidates(index, 'openai', 'completely-unrelated-identifier', {})).toEqual([])
  })

  it('offers the closest entries first and no more than it was asked for', () => {
    const similar = similarCandidates(index, 'openai', 'gpt-4p', {}, 1)
    expect(similar).toHaveLength(1)
    expect(similarCandidates(index, 'openai', 'gpt', {}, 2)).toHaveLength(2)
  })
})

describe('a pinned entry', () => {
  const index = indexOf({
    openai: { 'gpt-4o': entry('gpt-4o', { context_length: 128000 }) },
    azure: { 'gpt-4o': entry('gpt-4o', { context_length: 64000 }) },
  })

  it('answers with the entry it names, whatever the id would have resolved to', () => {
    // The route resolves to `openai`, and the id resolves there too, but the
    // reader pinned the other provider's entry — that is the whole point.
    expect(matchModel(index, 'openai', 'openai/gpt-4o', {})).toMatchObject({ providerKey: 'openai', strategy: 'exact' })
    expect(matchBound(index, 'openai', 'openai/gpt-4o', { providerId: 'azure', modelId: 'azure/gpt-4o' }, {}))
      .toMatchObject({ provider: 'openai', providerKey: 'azure', strategy: 'bound' })
  })

  it('reports the route provider key it would have resolved on its own', () => {
    expect(matchBound(index, 'openai', 'openai/gpt-4o', { providerId: 'azure', modelId: 'azure/gpt-4o' }, {}))
      .toMatchObject({ routeProviderKey: 'openai' })
  })

  it('answers for an id no comparison would have resolved at all', () => {
    // A gateway route whose stored id differs from every published spelling.
    expect(matchModel(index, 'my-gateway', 'internal-build-7', {})).toMatchObject({ strategy: 'none' })
    expect(matchBound(index, 'my-gateway', 'internal-build-7', { providerId: 'openai', modelId: 'openai/gpt-4o' }, {}))
      .toMatchObject({ strategy: 'bound', model: { id: 'openai/gpt-4o' } })
  })

  it('falls back to the comparisons when the catalog no longer publishes it', () => {
    // A pinned entry renamed upstream degrades to the automatic answer instead
    // of leaving the model unmatched.
    expect(matchBound(index, 'openai', 'openai/gpt-4o', { providerId: 'azure', modelId: 'azure/retired' }, {}))
      .toMatchObject({ strategy: 'exact', providerKey: 'openai' })
    // Without a resolved provider the fallback is a whole-document search, so
    // which provider answers is the document's own order rather than a promise.
    expect(matchBound(index, 'my-gateway', 'openai/gpt-4o', { providerId: 'azure', modelId: 'azure/retired' }, {}))
      .toMatchObject({ strategy: 'exact', model: { id: 'openai/gpt-4o' } })
  })

  it('falls back when the named provider is gone entirely', () => {
    expect(matchBound(index, 'openai', 'openai/gpt-4o', { providerId: 'retired-gateway', modelId: 'retired-gateway/gpt-4o' }, {}))
      .toMatchObject({ strategy: 'exact', providerKey: 'openai' })
  })

  it('matches the comparisons exactly when nothing is pinned', () => {
    expect(matchBound(index, 'openai', 'openai/gpt-4o', undefined, {})).toEqual(matchModel(index, 'openai', 'openai/gpt-4o', {}))
  })
})
