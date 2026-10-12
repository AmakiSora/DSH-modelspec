/**
 * The entry bindings this browser remembers: a panel preference beside the page
 * rather than deployment configuration, because the settings document validates
 * every write against the adapter's own schema and declares no field for it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindingHost, bindingKey, readBindings, writeBinding } from '../src/client/bindings.ts'

/** A storage that refuses every operation, as a private window does. */
class RefusingStorage {
  getItem(): string | null {
    throw new Error('refused')
  }

  setItem(): void {
    throw new Error('refused')
  }
}

/** The global to hand each case. */
const original = globalThis.localStorage

/** Install a storage for one case, or remove it entirely. */
function useStorage(value: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true })
}

/** A key one model is filed under. */
const KEY = bindingKey('llm-pi-ai/acme', 'gpt-4o')

/** Name this case's host, so a case cannot read another's session bindings. */
function ownHost(name: string): string {
  return `${name}-host`
}

describe('entry bindings', () => {
  beforeEach(() => {
    useStorage(undefined)
  })

  afterEach(() => {
    useStorage(original)
  })

  it('names a model by its route and id rather than its position', () => {
    // Reordering the namespace must not re-point every binding.
    expect(bindingKey('llm-pi-ai/acme', 'gpt-4o')).toBe(bindingKey('llm-pi-ai/acme', 'gpt-4o'))
    expect(bindingKey('llm-pi-ai/acme', 'gpt-4o')).not.toBe(bindingKey('llm-pi-ai/other', 'gpt-4o'))
    expect(bindingKey('llm-pi-ai/acme', 'gpt-4o')).not.toBe(bindingKey('llm-pi-ai/acme', 'gpt-4o-mini'))
  })

  it('keeps a binding for the session when the browser has no storage', () => {
    const scope = ownHost('session')
    expect(readBindings(scope)).toEqual(new Map())
    writeBinding(scope, KEY, { providerId: 'azure', modelId: 'gpt-4o' })
    expect(readBindings(scope).get(KEY)).toEqual({ providerId: 'azure', modelId: 'gpt-4o' })
  })

  it('takes a binding back when it is written without one', () => {
    const scope = ownHost('taken-back')
    writeBinding(scope, KEY, { providerId: 'azure', modelId: 'gpt-4o' })
    writeBinding(scope, KEY, undefined)
    expect(readBindings(scope).has(KEY)).toBe(false)
  })

  it('keeps one host apart from another', () => {
    const scope = ownHost('host-a')
    writeBinding(scope, KEY, { providerId: 'azure', modelId: 'gpt-4o' })
    expect(readBindings(`${scope}-elsewhere`).has(KEY)).toBe(false)
  })

  it('discards a file it cannot read rather than half-applying it', () => {
    const store = new Map<string, string>([
      ['model-aid/bindings/broken', '{not json'],
      ['model-aid/bindings/partial', JSON.stringify({ a: { providerId: 'p' }, b: { providerId: 'p', modelId: '' } })],
    ])
    useStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {},
    } as unknown as Storage)
    expect(readBindings('broken')).toEqual(new Map())
    // A half-written entry, and one missing half its name, are both skipped.
    expect([...readBindings('partial')]).toEqual([])
  })

  it('survives a storage that refuses every operation', () => {
    const scope = ownHost('refused')
    useStorage(RefusingStorage.prototype as unknown as Storage)
    // A refused read falls back to the session's bindings and a refused write
    // leaves them there: a browser with storage turned off must still be able to
    // open the panel, compare models, and pin an entry for the session.
    expect(readBindings(scope)).toEqual(new Map())
    writeBinding(scope, KEY, { providerId: 'azure', modelId: 'gpt-4o' })
    expect(readBindings(scope).get(KEY)).toEqual({ providerId: 'azure', modelId: 'gpt-4o' })
  })

  it('names the host the panel was served from', () => {
    expect(typeof bindingHost()).toBe('string')
  })
})