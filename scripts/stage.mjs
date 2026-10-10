/**
 * Stage the built plugin into a dsh profile's plugin directory.
 *
 * A dsh profile installs a third-party plugin as a plain dependency pointing at
 * this directory, so the staged copy is what the profile's resolver reads. It
 * carries only the two runtime artifacts and a manifest with no dependencies:
 * the browser bundle inlines everything the shell does not share, so a
 * dependency list here would only invite a second copy of a shared runtime.
 *
 * Usage: node scripts/stage.mjs [--out <dir>]
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'plugins', 'model-aid')

/** Artifacts the profile needs, relative to the project root. */
const ARTIFACTS = ['lib/index.js', 'lib/client.js', 'lib/client.js.map']

/** The staged manifest: the entry points, the client manifest, and nothing else. */
const MANIFEST = {
  name: 'model-aid',
  version: '0.1.0',
  private: true,
  type: 'module',
  main: 'lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './package.json': './package.json',
  },
  dsh: {
    client: {
      inject: [
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-sidebar',
      ],
      platform: 'web',
    },
  },
}

await rm(OUT, { recursive: true, force: true })
await mkdir(join(OUT, 'lib'), { recursive: true })
for (const artifact of ARTIFACTS) {
  await copyFile(join(ROOT, artifact), join(OUT, artifact))
}
await writeFile(join(OUT, 'package.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`)

process.stdout.write(`staged ${ARTIFACTS.length} artifacts to ${OUT}\n`)
