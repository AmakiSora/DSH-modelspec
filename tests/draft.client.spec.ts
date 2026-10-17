/**
 * The editor's value model: reading a stored entry into staged values, adopting
 * published values into them, checking what the adapters would refuse, and
 * turning the difference into the settings edits that commit it.
 */

import { describe, expect, it } from 'vitest'
import type { ConfiguredModel, ConfiguredRoute } from '../src/client/configured.ts'
import {
  adoptEntry, adoptField, draftDiffers, draftOf, draftOps, draftProblem, effortsOf, parseCapacity,
  reasoningDraft, sameEfforts, sameModalities, type ModelDraft,
} from '../src/client/draft.ts'
import type { ModelsDevModel } from '../src/client/types.ts'

/** One configured model entry. */
function model(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    index: 0,
    id: 'acme-1',
    inputModalities: ['text'],
    modalityField: 'input',
    ...overrides,
  }
}

/** One configured route holding the given models. */
function route(models: readonly ConfiguredModel[], overrides: Partial<ConfiguredRoute> = {}): ConfiguredRoute {
  return {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    displayName: 'Acme',
    settingsPath: ['providers', 'acme'],
    revision: 1,
    arrayLength: models.length,
    preset: false,
    reasoningCapable: true,
    models,
    ...overrides,
  }
}

/** One published catalog entry. */
function published(overrides: Partial<ModelsDevModel> = {}): ModelsDevModel {
  return {
    providerId: 'acme',
    id: 'acme-1',
    name: 'Acme One',
    inputModalities: ['text', 'image'],
    reasoning: true,
    toolCall: true,
    structuredOutput: false,
    temperature: true,
    ...overrides,
  }
}

describe('a staged model', () => {
  it('opens on the stored values, with no field changed', () => {
    const draft = draftOf(model({ name: 'Acme One', contextWindow: 131072, maxTokens: 4096 }))
    expect(draft).toMatchObject({
      baseId: 'acme-1',
      id: 'acme-1',
      name: 'Acme One',
      contextWindow: '131072',
      maxTokens: '4096',
      inputModalities: ['text'],
    })
    expect(draftDiffers(draft, model({ name: 'Acme One', contextWindow: 131072, maxTokens: 4096 }))).toBe(false)
  })

  it('keeps an entry that declares no modality as declaring none, not as text', () => {
    // An empty list inherits the route's own, so opening it in the editor must
    // not stage a value: every such row would open as an unsaved edit.
    const bare = model({ inputModalities: [] })
    const draft = draftOf(bare)
    expect(draft.inputModalities).toEqual([])
    expect(draftDiffers(draft, bare)).toBe(false)
  })

  it('reads each of the three reasoning declarations back', () => {
    expect(draftOf(model()).reasoning).toEqual({ mode: 'inherit', levels: [] })
    expect(draftOf(model({ reasoningEfforts: false })).reasoning).toEqual({ mode: 'none', levels: [] })
    expect(draftOf(model({ reasoningEfforts: { low: 'low', off: null } })).reasoning).toEqual({
      mode: 'levels',
      levels: [{ level: 'off', wire: '' }, { level: 'low', wire: 'low' }],
    })
  })

  it('reports a changed field as an unsaved edit', () => {
    const stored = model({ contextWindow: 131072 })
    expect(draftDiffers({ ...draftOf(stored), contextWindow: '64000' }, stored)).toBe(true)
    expect(draftDiffers({ ...draftOf(stored), name: 'Renamed' }, stored)).toBe(true)
    expect(draftDiffers({ ...draftOf(stored), id: 'other' }, stored)).toBe(true)
    expect(draftDiffers({ ...draftOf(stored), inputModalities: ['text', 'image'] }, stored)).toBe(true)
  })

  it('treats a field cleared back to its unset state as a change', () => {
    const stored = model({ contextWindow: 131072 })
    expect(draftDiffers({ ...draftOf(stored), contextWindow: '' }, stored)).toBe(true)
    const absent = model()
    expect(draftDiffers({ ...draftOf(absent), contextWindow: '' }, absent)).toBe(false)
  })
})

describe('a capacity field', () => {
  it('reads a blank field as unset, a positive integer as its count', () => {
    expect(parseCapacity('')).toEqual({ kind: 'unset' })
    expect(parseCapacity('   ')).toEqual({ kind: 'unset' })
    expect(parseCapacity('1024')).toEqual({ kind: 'count', value: 1024 })
  })

  it('refuses anything the adapters would refuse', () => {
    for (const text of ['0', '-1', '1.5', '1e6', 'abc', '1024k', '99999999999999999999']) {
      expect(parseCapacity(text)).toEqual({ kind: 'invalid' })
    }
  })
})

describe('a reasoning declaration', () => {
  it('writes off as the level that sends no parameter once another level exists', () => {
    const efforts = effortsOf({ mode: 'levels', levels: [{ level: 'off', wire: '' }, { level: 'high', wire: 'high' }] })
    expect(efforts).toEqual({ off: null, high: 'high' })
  })

  it('declares nothing when only off is left blank', () => {
    expect(effortsOf({ mode: 'levels', levels: [{ level: 'off', wire: '' }] })).toBeUndefined()
    expect(effortsOf({ mode: 'levels', levels: [] })).toBeUndefined()
  })

  it('keeps a wire value the reader typed for off', () => {
    expect(effortsOf({ mode: 'levels', levels: [{ level: 'off', wire: 'none' }, { level: 'low', wire: 'low' }] }))
      .toEqual({ off: 'none', low: 'low' })
  })

  it('writes the outright non-reasoning declaration', () => {
    expect(effortsOf({ mode: 'none', levels: [] })).toBe(false)
    expect(effortsOf({ mode: 'inherit', levels: [] })).toBeUndefined()
  })

  it('compares declarations level by level, with an absent level equal to an absent declaration', () => {
    expect(sameEfforts({ off: null, low: 'low' }, { low: 'low' })).toBe(false)
    expect(sameEfforts({ off: null, low: 'low' }, { off: null, low: 'low' })).toBe(true)
    expect(sameEfforts(undefined, undefined)).toBe(true)
    expect(sameEfforts(false, false)).toBe(true)
    expect(sameEfforts(false, undefined)).toBe(false)
  })

  it('does not invent an off level an entry never declared', () => {
    // A dict without `off` pins stopping unsupported; adding the key while the
    // row is untouched would open every such model as an unsaved edit.
    const stored = model({ reasoningEfforts: { low: 'low', high: 'high' } })
    expect(effortsOf(draftOf(stored).reasoning)).toEqual({ low: 'low', high: 'high' })
    expect(draftDiffers(draftOf(stored), stored)).toBe(false)
    expect(draftOps(route([stored]), stored, draftOf(stored))).toEqual([])
  })

  it('round-trips a stored dict through the editor', () => {
    const stored = { off: null, low: 'low', high: 'high' } as const
    expect(effortsOf(reasoningDraft(stored))).toEqual({ off: null, low: 'low', high: 'high' })
  })

  it('compares modality lists as sets', () => {
    expect(sameModalities(['text', 'image'], ['image', 'text'])).toBe(true)
    expect(sameModalities(['text'], ['text', 'image'])).toBe(false)
  })
})

describe('adopting published values', () => {
  const entry = published({ contextWindow: 1048576, maxOutputTokens: 8192, declaredEfforts: { off: null, high: 'high' } })

  it('fills every field the entry publishes and leaves the rest alone', () => {
    const adopted = adoptEntry(draftOf(model({ contextWindow: 131072, maxTokens: 4096 })), entry)
    expect(adopted.contextWindow).toBe('1048576')
    expect(adopted.maxTokens).toBe('8192')
    expect(adopted.name).toBe('Acme One')
    expect(adopted.inputModalities).toEqual(['text', 'image'])
    expect(adopted.reasoning.mode).toBe('levels')
  })

  it('leaves a capacity the catalog stays silent about to the deployment', () => {
    const adopted = adoptEntry(draftOf(model({ contextWindow: 131072 })), published())
    expect(adopted.contextWindow).toBe('131072')
    expect(adopted.maxTokens).toBe('')
  })

  it('adopts one field without touching the others', () => {
    const draft = draftOf(model({ contextWindow: 131072, maxTokens: 4096 }))
    const adopted = adoptField(draft, 'contextWindow', 524288)
    expect(adopted.contextWindow).toBe('524288')
    expect(adopted.maxTokens).toBe(draft.maxTokens)
    expect(adoptField(draft, 'input', ['text', 'image']).inputModalities).toEqual(['text', 'image'])
    expect(adoptField(draft, 'reasoningEfforts', false).reasoning).toEqual({ mode: 'none', levels: [] })
  })
})

describe('checking a staged model', () => {
  const stored = model({ index: 0, id: 'acme-1' })
  const sibling = model({ index: 1, id: 'acme-2' })
  const configured = route([stored, sibling])

  it('accepts a draft that changed nothing', () => {
    expect(draftProblem(configured, stored, draftOf(stored))).toBeUndefined()
  })

  it('refuses an empty id', () => {
    expect(draftProblem(configured, stored, { ...draftOf(stored), id: '  ' })).toBe('empty-id')
  })

  it('refuses an id another model of the route already holds, but not its own', () => {
    expect(draftProblem(configured, stored, { ...draftOf(stored), id: 'acme-2' })).toBe('duplicate-id')
    expect(draftProblem(configured, stored, { ...draftOf(stored), id: 'acme-1' })).toBeUndefined()
  })

  it('refuses a capacity that is not a positive integer', () => {
    expect(draftProblem(configured, stored, { ...draftOf(stored), contextWindow: '0' })).toBe('invalid-context')
    expect(draftProblem(configured, stored, { ...draftOf(stored), maxTokens: '1.5' })).toBe('invalid-output')
  })

  it('refuses a reasoning dict that offers no level beyond off', () => {
    expect(draftProblem(configured, stored, {
      ...draftOf(stored),
      reasoning: { mode: 'levels', levels: [{ level: 'off', wire: '' }] },
    })).toBe('invalid-efforts')
  })
})

describe('committing a staged model', () => {
  const stored = model({ index: 2, id: 'acme-1', name: 'Acme One', contextWindow: 131072, maxTokens: 4096 })
  const configured = route([stored])

  it('writes nothing when the draft changed nothing', () => {
    expect(draftOps(configured, stored, draftOf(stored))).toEqual([])
  })

  it('addresses only the fields that moved', () => {
    expect(draftOps(configured, stored, { ...draftOf(stored), contextWindow: '64000' })).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'contextWindow'], value: 64000 },
    ])
  })

  it('hands a cleared field back to the adapter', () => {
    expect(draftOps(configured, stored, { ...draftOf(stored), contextWindow: '', name: '' })).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'models', '2', 'name'] },
      { op: 'unset', path: ['providers', 'acme', 'models', '2', 'contextWindow'] },
    ])
  })

  it('addresses an id the edit renamed', () => {
    expect(draftOps(configured, stored, { ...draftOf(stored), id: ' acme-renamed ' })).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'id'], value: 'acme-renamed' },
    ])
  })

  it('writes the modality list under the field its namespace family declares', () => {
    expect(draftOps(
      configured,
      { ...stored, modalityField: 'inputModalities' },
      { ...draftOf({ ...stored, modalityField: 'inputModalities' }), inputModalities: ['text', 'image'] },
    )).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'inputModalities'], value: ['text', 'image'] },
    ])
  })

  it('writes and unsets the reasoning declaration as the adapter takes it', () => {
    const base: ModelDraft = draftOf(stored)
    expect(draftOps(configured, stored, {
      ...base,
      reasoning: { mode: 'levels', levels: [{ level: 'off', wire: '' }, { level: 'high', wire: 'high' }] },
    })).toEqual([
      { op: 'set', path: ['providers', 'acme', 'models', '2', 'reasoningEfforts'], value: { off: null, high: 'high' } },
    ])
    expect(draftOps(configured, { ...stored, reasoningEfforts: { high: 'high' } }, {
      ...base,
      reasoning: { mode: 'inherit', levels: [] },
    })).toEqual([
      { op: 'unset', path: ['providers', 'acme', 'models', '2', 'reasoningEfforts'] },
    ])
  })

  it('leaves a field its namespace family does not declare alone', () => {
    const bare = model({ index: 0, id: 'acme-1', inputModalities: [], modalityField: undefined })
    expect(draftOps(route([bare]), bare, { ...draftOf(bare), inputModalities: ['text', 'image'] })).toEqual([])
  })
})
