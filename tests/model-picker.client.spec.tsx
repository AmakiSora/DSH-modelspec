// @vitest-environment jsdom
/**
 * The effort fields the add-model and edit-model dialogs share: reading a stored
 * or published declaration into one field per level, and reading those fields
 * back into the declaration a namespace stores.
 */

import { describe, expect, it } from 'vitest'
import { effortFields, effortsFromFields } from '../src/client/ModelPicker.tsx'
import type { PickerFields } from '../src/client/ModelPicker.tsx'
import type { ReasoningLevel } from '../src/client/types.ts'
import { REASONING_LEVELS } from '../src/client/types.ts'

/** One field block holding the given levels; every other level is left blank. */
function fields(efforts: Partial<Record<ReasoningLevel, string>> = {}, noReasoning = false): PickerFields {
  const blanks = Object.fromEntries(REASONING_LEVELS.map(level => [level, ''])) as Record<ReasoningLevel, string>
  return { name: '', context: '', output: '', image: false, noReasoning, efforts: { ...blanks, ...efforts } }
}

describe('reading a declaration into the effort fields', () => {
  it('shows each declared level as its wire spelling, and a valueless off as a blank field', () => {
    expect(effortFields({ off: null, low: 'low', max: 'xhigh' })).toEqual({
      noReasoning: false,
      efforts: { off: '', minimal: '', low: 'low', medium: '', high: '', xhigh: '', max: 'xhigh' },
    })
  })

  it('reads a declaration the entry does not carry as every level blank', () => {
    expect(effortFields(undefined)).toEqual({ noReasoning: false, efforts: fields().efforts })
  })

  it('reads a non-reasoning model as the switch, with every level blank', () => {
    expect(effortFields(false)).toEqual({ noReasoning: true, efforts: fields().efforts })
  })
})

describe('reading the effort fields back into a declaration', () => {
  it('writes a blank off as the level that is supported and sends no parameter', () => {
    expect(effortsFromFields(fields({ low: 'low', high: 'high', max: 'xhigh' })))
      .toEqual({ off: null, low: 'low', high: 'high', max: 'xhigh' })
  })

  it('round-trips the declaration a catalog entry published', () => {
    // An adopted entry always publishes `off`, which fills the field blank — so a
    // blank field that was dropped instead of written back pinned the level
    // unsupported, and the model offered no way to stop reasoning.
    const published = { off: null, low: 'low', high: 'high', max: 'max' }
    expect(effortsFromFields(effortFields(published))).toEqual(published)
  })

  it('keeps an off spelling the reader typed', () => {
    expect(effortsFromFields(fields({ off: 'none', low: 'low' }))).toEqual({ off: 'none', low: 'low' })
  })

  it('declares nothing when every level is blank, whitespace included', () => {
    expect(effortsFromFields(fields())).toBeUndefined()
    expect(effortsFromFields(fields({ off: '   ' }))).toBeUndefined()
  })

  it('carries an off spelling that stands alone out to the draft rule', () => {
    // An `off`-only declaration is one the adapter refuses, so the dialog has to
    // see it and refuse the write with a reason rather than declaring nothing.
    expect(effortsFromFields(fields({ off: 'none' }))).toEqual({ off: 'none' })
  })

  it('writes the non-reasoning switch as the outright false', () => {
    expect(effortsFromFields(fields({ low: 'low' }, true))).toBe(false)
  })
})
