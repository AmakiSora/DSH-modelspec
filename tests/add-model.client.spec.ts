/**
 * Adding one model to a route: the default template a dialog fills when the
 * catalog published nothing, the single edit that appends the entry, and the
 * rules that keep a draft the route would refuse out of the write.
 */

import { describe, expect, it } from 'vitest'
import { addModelOps, newModelProblem, newModelTemplate } from '../src/client/add-model.ts'
import type { NewModelEntry } from '../src/client/add-model.ts'
import type { ConfiguredModel, ConfiguredRoute } from '../src/client/configured.ts'

/** One configured model entry, with only the fields a case needs. */
function model(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return { index: 0, id: 'acme-1', inputModalities: ['text'], ...overrides }
}

/** One declared route holding the given models. */
function route(overrides: Partial<ConfiguredRoute> = {}): ConfiguredRoute {
  const models = overrides.models ?? [model()]
  return {
    settingsNs: 'llm-pi-ai',
    provider: 'acme',
    displayName: 'Acme',
    settingsPath: ['providers', 'acme'],
    revision: 3,
    arrayLength: models.length,
    preset: false,
    ...overrides,
    models,
  }
}

/** One draft, with only the fields a case needs. */
function entry(overrides: Partial<NewModelEntry> = {}): NewModelEntry {
  return { id: 'acme-2', inputModalities: ['text'], ...overrides }
}

describe('the default template', () => {
  it('copies the capacities of the last model that declares any', () => {
    const template = newModelTemplate(route({
      models: [
        model({ id: 'a', contextWindow: 4096, maxTokens: 512 }),
        model({ id: 'b' }),
        model({ id: 'c', contextWindow: 200000, maxTokens: 32000, modalityField: 'input' }),
      ],
    }))
    expect(template).toEqual({ contextWindow: 200000, maxTokens: 32000, inputModalities: ['text'], modalityField: 'input' })
  })

  it('names the family even when no model declares a capacity', () => {
    const template = newModelTemplate(route({
      models: [model({ modalityField: 'inputModalities', inputModalities: ['text', 'image'] })],
    }))
    expect(template).toEqual({ inputModalities: ['text', 'image'], modalityField: 'inputModalities' })
  })

  it('reads an entry that declares no modalities as accepting text', () => {
    // pi-ai stores `input` and defaults it to `[]`, so copying it verbatim
    // would start the new entry off claiming it accepts nothing.
    const template = newModelTemplate(route({ models: [model({ inputModalities: [], modalityField: 'input' })] }))
    expect(template.inputModalities).toEqual(['text'])
  })

  it('omits every capacity no model declares, rather than inventing one', () => {
    expect(newModelTemplate(route({ models: [model()] }))).toEqual({ inputModalities: ['text'] })
  })
})

describe('the appending write', () => {
  it('sets one element at the first index past the end of the array', () => {
    expect(addModelOps(route({ models: [model(), model({ index: 1, id: 'acme-2' })] }), entry({ id: 'acme-3' })))
      .toEqual([{ op: 'set', path: ['providers', 'acme', 'models', '2'], value: { id: 'acme-3' } }])
  })

  it('addresses the array the namespace really holds, unread entries included', () => {
    // The panel shows one row for three stored entries, so the readable count
    // would overwrite the entry the panel could not read.
    expect(addModelOps(route({ models: [model()], arrayLength: 3 }), entry())[0]?.path)
      .toEqual(['providers', 'acme', 'models', '3'])
  })

  it('carries only the values the draft declares', () => {
    const ops = addModelOps(route(), entry({
      name: '  Acme 2  ',
      contextWindow: 200000,
      maxTokens: 8192,
      inputModalities: ['text', 'image'],
      modalityField: 'input',
    }))
    expect(ops).toEqual([{
      op: 'set',
      path: ['providers', 'acme', 'models', '1'],
      value: { id: 'acme-2', name: 'Acme 2', contextWindow: 200000, maxTokens: 8192, input: ['text', 'image'] },
    }])
  })

  it('leaves the modality field out when the namespace family is unknown', () => {
    // Writing one of the two spellings at random would store a field the
    // resolved profile never materializes.
    expect(addModelOps(route(), entry({ inputModalities: ['text', 'image'] }))[0])
      .toEqual({ op: 'set', path: ['providers', 'acme', 'models', '1'], value: { id: 'acme-2' } })
  })

  it('drops an empty display name rather than storing one', () => {
    expect(addModelOps(route(), entry({ name: '   ' }))[0])
      .toEqual({ op: 'set', path: ['providers', 'acme', 'models', '1'], value: { id: 'acme-2' } })
  })

  it('trims the id it appends', () => {
    expect(addModelOps(route(), entry({ id: '  acme-2  ' }))[0])
      .toEqual({ op: 'set', path: ['providers', 'acme', 'models', '1'], value: { id: 'acme-2' } })
  })
})

describe('the draft rules', () => {
  it('accepts a draft the route could store', () => {
    expect(newModelProblem(route(), entry())).toBeUndefined()
  })

  it('refuses an empty id, including one that is only whitespace', () => {
    expect(newModelProblem(route(), entry({ id: '' }))).toBe('empty-id')
    expect(newModelProblem(route(), entry({ id: '   ' }))).toBe('empty-id')
  })

  it('refuses an id the route already configures, however it was spelled', () => {
    expect(newModelProblem(route(), entry({ id: 'acme-1' }))).toBe('duplicate-id')
    expect(newModelProblem(route(), entry({ id: '  acme-1  ' }))).toBe('duplicate-id')
    expect(newModelProblem(route({ models: [model({ id: 'acme-2' })] }), entry({ id: 'acme-2' }))).toBe('duplicate-id')
  })

  it('refuses a capacity neither adapter would accept', () => {
    expect(newModelProblem(route(), entry({ contextWindow: 0 }))).toBe('invalid-context')
    expect(newModelProblem(route(), entry({ contextWindow: -1 }))).toBe('invalid-context')
    expect(newModelProblem(route(), entry({ contextWindow: 1.5 }))).toBe('invalid-context')
    expect(newModelProblem(route(), entry({ contextWindow: Number.NaN }))).toBe('invalid-context')
    expect(newModelProblem(route(), entry({ maxTokens: 0 }))).toBe('invalid-output')
  })

  it('leaves a capacity the draft does not declare alone', () => {
    expect(newModelProblem(route(), entry({ contextWindow: undefined, maxTokens: undefined }))).toBeUndefined()
  })

  it('reports the id before the capacity, so the reader is told the first thing to fix', () => {
    expect(newModelProblem(route(), entry({ id: 'acme-1', contextWindow: 0 }))).toBe('duplicate-id')
  })
})