/**
 * The catalog address this browser stores for itself: an override that wins
 * over the shipped default, kept in local storage beside the bindings, and a
 * session fallback where storage is absent or refused.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATALOG_ENDPOINT, readCatalogEndpoint, writeCatalogEndpoint } from '../src/client/catalog-endpoint.ts'

/** One jsdom window per case, so the storage each reads is its own. */
describe('the stored catalog endpoint', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })

  it('answers with nothing when no address is stored', () => {
    expect(readCatalogEndpoint('host')).toBeUndefined()
    expect(DEFAULT_CATALOG_ENDPOINT).toContain('openrouter.ai')
  })

  it('keeps one address per host', () => {
    writeCatalogEndpoint('host-a', 'https://mirror.example/api')
    writeCatalogEndpoint('host-b', 'https://other.example/api')
    expect(readCatalogEndpoint('host-a')).toBe('https://mirror.example/api')
    expect(readCatalogEndpoint('host-b')).toBe('https://other.example/api')
  })

  it('restores the default by taking the override back', () => {
    writeCatalogEndpoint('host', 'https://mirror.example/api')
    writeCatalogEndpoint('host', undefined)
    expect(readCatalogEndpoint('host')).toBeUndefined()
  })

  it('keeps the value in storage, where a later read finds it', () => {
    writeCatalogEndpoint('host', 'https://mirror.example/api')
    expect(globalThis.localStorage.getItem('dsh-modelspec/catalog-endpoint/host')).toBe('https://mirror.example/api')
  })

  it('answers a stored-but-empty file with nothing rather than an empty address', () => {
    globalThis.localStorage?.setItem('dsh-modelspec/catalog-endpoint/host', '')
    expect(readCatalogEndpoint('host')).toBeUndefined()
  })
})
