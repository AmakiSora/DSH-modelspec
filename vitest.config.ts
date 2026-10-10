import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const uiPrimitivesDouble = fileURLToPath(new URL('./tests/support/ui-primitives.tsx', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Tests run without the web shell, so the shared primitives resolve to a
      // local double rather than to their published `lib/`. See the double's
      // header for why that is the smaller dependency graph. Production is
      // unaffected: the bundle externalizes this specifier to the shell.
      '@deepseek-ai/dsh-client-ui-primitives': uiPrimitivesDouble,
    },
  },
  test: {
    // Component specs select jsdom with a per-file `@vitest-environment jsdom`
    // pragma; everything else runs in node.
    include: ['tests/**/*.spec.{ts,tsx}'],
    // Forked workers: the specs share process-level fixtures and jsdom's global
    // registry, which worker threads isolate less reliably than separate processes.
    pool: 'forks',
    server: {
      deps: {
        // The snapshot store's published `lib/` is plain JavaScript with no
        // stylesheet import, but it must still go through Vite so its own
        // dependencies resolve in this tree.
        inline: [/dsh-client-store/],
      },
    },
  },
})
