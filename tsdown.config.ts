/**
 * Build configuration for the model-aid dsh client plugin.
 *
 * The browser half must match the artifact contract the dsh web shell expects
 * from every client plugin, because the shell loads `lib/client.js` itself:
 *
 * - it is CommonJS wrapped in a `window.__ModuleLoader__.load({ id, factory })`
 *   call, so the shell hands the factory a `require` bound to its own module
 *   table;
 * - every specifier in SHARED_MODULES stays an import resolved through that
 *   table, so the plugin shares React, Cordis, and the ui-primitives/slots/store
 *   runtime identities with the shell instead of inlining private copies;
 * - every other bare specifier is inlined, because a `require` the table cannot
 *   answer would throw at load;
 * - `*.module.css` is compiled here and injected as a tagged `<style>` at factory
 *   execution, returning the hashed class map the components import.
 *
 * The node half is an empty `apply()`: the whole feature ships through the
 * browser bundle, so the package installs into any profile as one client row
 * with no Host service and no Remote.
 */
import { readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import { defineConfig, type UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Package name, stamped into the `__ModuleLoader__` handoff and the style tags. */
const PACKAGE = 'model-aid'

/**
 * Module-table specifiers the shell seeds. These must resolve to the shell's own
 * copies: inlining them would give the plugin a second React or a second store
 * instance, and a context or snapshot created by one would be invisible to the
 * other. Kept as an exact list — a missing entry is a runtime throw, and an
 * extra one silently splits an identity.
 */
const SHARED_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/**
 * Value specifiers this package legitimately inlines: vendored framework
 * libraries with no cross-plugin identity, and wire layers that exist to be
 * inlined. Anything else under `@deepseek-ai/` that is not in SHARED_MODULES is
 * a cross-plugin value import, which the purity plugin rejects.
 */
const INLINABLE = /^(?:@deepseek-ai\/dsh-(?:util-values|util-crypto|brand|typert-protocol)(?:\/|$)|@deepseek-ai\/(?:cosmokit|schemastery)(?:\/|$))/

/** Virtual-id prefix for compiled stylesheets; the suffix keeps ids off tsdown's own css pipeline. */
const CSS_PREFIX = '\0model-aid-css:'
const CSS_SUFFIX = '.mjs'

/**
 * Compile one CSS Module into a self-injecting module: it appends a tagged
 * `<style>` once per page and default-exports the hashed class map.
 * @param fileId - absolute path of the stylesheet, used as the injection tag key.
 * @param code - compiled CSS text.
 * @param classMap - local class name to emitted class name.
 * @returns the generated module source.
 */
function styleInjectionModule(fileId: string, code: string, classMap?: Record<string, string>): string {
  const tagId = JSON.stringify(`${PACKAGE}/${fileId.slice(fileId.lastIndexOf('/') + 1)}`)
  return [
    `const css = ${JSON.stringify(code)};`,
    `const tagId = ${tagId};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(PACKAGE)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/**
 * Compile CSS Modules at build time and reject cross-plugin value imports.
 * @returns the tsdown plugins implementing both rules.
 */
function clientPlugins(): NonNullable<UserConfig['plugins']> {
  return [
    {
      name: 'model-aid-css-modules',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const absolute = importer === undefined ? source : new URL(source, `file:///${importer.replace(/\\/g, '/')}`).pathname.replace(/^\//, '')
        return CSS_PREFIX + absolute + CSS_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_PREFIX)) return null
        const fileId = virtualId.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
        // The virtual id would otherwise hide the physical sheet from the watch graph.
        this.addWatchFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          // Bytes, not a decoded string: lightningcss's WASM boundary cannot
          // introspect a JS string and reports "Get TypedArray info failed".
          code: await readFile(fileId),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, entry] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          classMap[local] = entry.name
        }
        return styleInjectionModule(fileId, code.toString(), classMap)
      },
    },
    {
      name: 'model-aid-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (SHARED_MODULES.has(source)) return null
        if (INLINABLE.test(source)) return null
        throw new Error(
          `model-aid bundle purity: "${source}" is not a shell module-table entry or an inline-safe layer. `
          + 'A cross-plugin value import would either duplicate a shared runtime identity or need a module request this package has not declared.',
        )
      },
    },
  ]
}

export default defineConfig([
  {
    name: `${PACKAGE}/lib`,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PACKAGE}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    // Types ship from lib/types via tsc; dts here would emit .d.cts and break parsing.
    dts: false,
    // The shell fetches this artifact outside its own module graph, so it must
    // carry the TS/TSX mapping that browser devtools consume.
    sourcemap: true,
    // One lib/ directory serves both halves; a default clean would wipe the node half.
    clean: false,
    deps: {
      neverBundle: specifier => SHARED_MODULES.has(specifier),
      alwaysBundle: specifier => !isBuiltin(specifier) && !SHARED_MODULES.has(specifier),
    },
    // zustand-shaped libraries probe both `process.env.NODE_ENV` and
    // `import.meta.env.MODE`; a CJS output cannot carry the latter, so both are
    // substituted rather than left to throw ReferenceError when the factory runs.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: clientPlugins(),
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      // Order matters: the loader call opens the factory, `intro` declares the
      // CommonJS module object inside it, and the footer closes both.
      banner: chunk => `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
