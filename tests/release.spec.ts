/**
 * The release metadata, checked against itself.
 *
 * Every fact here is stated in more than one file, and each pair is a way the
 * project can quietly disagree with itself: a bundle that registers under a name
 * its package no longer declares, a version in the manifest that no changelog
 * section describes, a tag nobody can place. None of that is visible from a code
 * review, and all of it is visible from here.
 *
 * The sources are read as text rather than imported. Importing `tsdown.config.ts`
 * would pull the build toolchain into the unit suite to answer a question about
 * one string literal, and the string literal is the whole subject.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The repository root, from this file's own location. */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** One file of the repository, decoded. */
function source(relative: string): string {
  return readFileSync(new URL(relative, `file:///${ROOT.replace(/\\/g, '/')}/`), 'utf8')
}

/** The package manifest, which is the source of the name and the version. */
const manifest = JSON.parse(source('package.json')) as { name: string; version: string; license?: string }

/** The changelog, as written. */
const changelog = source('CHANGELOG.md')

/**
 * The value one `const NAME = '…'` declaration holds, wherever it is declared.
 * @param text - the file to read.
 * @param constant - the constant's name.
 * @returns the string it is assigned, or `undefined` when it is not declared there.
 */
function declared(text: string, constant: string): string | undefined {
  return new RegExp(`const ${constant} = '([^']+)'`).exec(text)?.[1]
}

describe('release metadata', () => {
  it('names the bundle and the package the same thing', () => {
    // The two are declared separately on purpose: the registration id is the
    // plugin's runtime identity, and a package published under an npm scope must
    // not silently rename the plugin every install already refers to.
    expect(declared(source('tsdown.config.ts'), 'PACKAGE')).toBe(manifest.name)
  })

  it('stages under the name the package declares', () => {
    // stage.mjs reads it rather than restating it, so this is about the read
    // staying a read rather than a hardcoded copy coming back.
    const staging = source('scripts/stage.mjs')
    expect(staging).toContain('PACKAGE.name')
    expect(declared(staging, 'NAME')).toBeUndefined()
  })

  it('carries a version that is valid semantic versioning', () => {
    // The specification's own regular expression, without the optional
    // pre-release and build parts this project does not use.
    expect(manifest.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  })

  it('describes the version it is on in the changelog', () => {
    // A version nobody wrote down is one nobody can act on.
    expect(changelog).toContain(`## [${manifest.version}]`)
  })

  it('compares from the released version, not from one it has moved past', () => {
    expect(changelog).toContain(`/compare/v${manifest.version}...HEAD`)
  })

  it('dates the changelog entry the way the format asks', () => {
    expect(changelog).toMatch(new RegExp(`## \\[${manifest.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`))
  })

  it('uses only the changelog categories the format defines', () => {
    const headings = [...changelog.matchAll(/^### (.+)$/gm)].map(match => match[1])
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) {
      expect(['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']).toContain(heading)
    }
  })

  it('says it is on 0.y.z while it has not promised a stable API', () => {
    // 1.0.0 is a decision to support the panel's behaviour, not a number the
    // next feature is allowed to roll over into by accident.
    expect(manifest.version.startsWith('0.')).toBe(true)
  })

  it('ships the text of the license the manifest declares', () => {
    // A manifest field grants nothing on its own: with no LICENSE file the
    // default is all rights reserved, which is the opposite of what the field
    // says, and a public repository is exactly where that matters.
    expect(manifest.license).toBe('MIT')
    expect(source('LICENSE')).toContain('MIT License')
    expect(source('LICENSE')).toMatch(/Copyright \(c\) \d{4} \S/)
  })
})
