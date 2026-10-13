/**
 * Stage the built plugin into a dsh profile's plugin directory.
 *
 * A dsh profile installs a third-party plugin as a plain dependency pointing at
 * this directory, so the staged copy is what the profile's resolver reads. It
 * carries only the runtime artifacts, the bundle patch, and a manifest with no
 * dependencies: the browser bundle inlines everything the shell does not share,
 * so a dependency list here would only invite a second copy of a shared runtime.
 *
 * The patch travels with the artifacts because it is what makes this directory
 * installable the way dsh installs a plugin: a package that declares no
 * `dsh.bundle` is refused before it is ever composed, and a declared patch whose
 * file is missing has no layer to apply.
 *
 * The staged manifest is a re-emission of the package manifest, so the name, the
 * version, and the `dsh` section are read from package.json rather than restated
 * here: a fact that changes every release has no business living in two files,
 * and a hand-copied `dsh` block is one that can drift from the published one. The
 * directory follows the name because it is the path a profile's dependency key
 * points at.
 *
 * The bundle's own registration id is *not* read from here. It is declared in
 * tsdown.config.ts, and `tests/release.spec.ts` fails if the two disagree.
 *
 * Usage: node scripts/stage.mjs [--out <dir>]
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const NAME = PACKAGE.name
const OUT = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'plugins', NAME)

/** Artifacts the profile needs, relative to the project root. */
const ARTIFACTS = ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'cordis.patch.yml']

/** The staged manifest: the entry points, the bundle declaration, and nothing else. */
const MANIFEST = {
  name: NAME,
  version: PACKAGE.version,
  private: true,
  type: 'module',
  main: 'lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './cordis.patch.yml': './cordis.patch.yml',
    './package.json': './package.json',
  },
  dsh: PACKAGE.dsh,
}

await rm(OUT, { recursive: true, force: true })
await mkdir(join(OUT, 'lib'), { recursive: true })
for (const artifact of ARTIFACTS) {
  await copyFile(join(ROOT, artifact), join(OUT, artifact))
}
await writeFile(join(OUT, 'package.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`)

process.stdout.write(`staged ${ARTIFACTS.length} artifacts to ${OUT}\n`)
