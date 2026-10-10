# model-aid

A [dsh](https://github.com/deepseek-ai/deepseek-harness) web-client plugin. It reads the
[models.dev](https://models.dev) catalog, compares it against the models this deployment
actually configured, and writes the differences back.

The panel is the **Model specs** entry in the left sidebar. One card per configured provider
route, one row per model inside it, and the stored value beside the published one wherever
they disagree. You can adopt one model's values, one route's, or the whole page at once.
Each route also carries **Add model**, which looks a model up in the catalog and appends it to
that route's configuration.

## What it does

- **Compares only what you configured.** The adapter directory publishes every route an LLM
  adapter knows about — pi-ai alone ships three dozen — so a route appears only when its
  settings namespace resolves a profile that declares at least one model.
- **Never writes a preset.** A route the adapter ships itself (`deepseek-official`,
  `deepseek-account`, pi-ai's own catalog routes) is compared but never written. The rule is
  the directory's own `declared` answer, not a list of names, so it tracks whatever the
  installed DSH considers a preset. A preset route offers no **Add model** button either.
- **Shows how confident each match is.** An entry located by identical model id looks
  different from one reached after dropping a vendor prefix or ignoring punctuation; the page
  names the comparison that found it.
- **Refuses to invent.** A field the catalog does not publish is never proposed, and a model
  with no catalog entry at all is reported as unmatched rather than guessed at.

Fields covered: context window, max output tokens, and accepted input modalities.

## Adding a model

**Add model** on a route card opens a dialog that asks for a model id and fills the rest.

- **One entry matched.** The published values fill the fields and the dialog names the
  comparison that found it.
- **Several entries matched.** Every one is offered, with the provider it came from and the
  capacities it publishes, and nothing is chosen until you pick. The same precedence a
  comparison uses decides which entries are offered at all: the resolved provider first, then
  every provider, and a loose comparison only once the precise ones found nothing.
- **Nothing matched.** **Fuzzy search** asks the looser question — which published ids came
  close — and offers them nearest first, each labelled with *why* it was offered: identical
  once folded, one id containing the other, or *n* characters apart. A mistyped character, a
  truncated paste, and a dated variant all land here, because every comparison needs an exact
  relationship. It is a button rather than something every keystroke pays for: the edit budget
  is one character for a five-to-eight-character id, two for a longer one, and none below that,
  where one edit would reach most of the document. The route's own provider breaks ties.
- **Still nothing.** The dialog falls back to a default template built from the models that
  route already configures — the last one that declares a capacity donates its values and its
  namespace's modality field — and says so.

The fields are editable, and the confirm button answers the route's own rules rather than the
catalog's: an id the route already configures, or a capacity that is not a positive integer,
is refused with the reason shown. Enter submits from the id field.

The write itself is one path-addressed `set` at the first index past the end of the namespace's
`models` array, which is how the settings document appends. The address is that array's own
length rather than the number of rows the panel shows, so an entry the panel could not read is
never overwritten. The namespace revision guards it, and a refusal leaves the dialog open with
what you typed.

## Requirements

Dsh `0.2.1-alpha.2` or later. The plugin is built against the published `@deepseek-ai/dsh-*`
packages at that version and relies on the web shell's client module table.

## Build

```sh
pnpm install
pnpm run build      # tsc emits lib/types, tsdown emits lib/index.js and lib/client.js
pnpm run test
pnpm run typecheck
pnpm run lint
```

`pnpm run build` produces three artifacts:

| File | Role |
| --- | --- |
| `lib/index.js` | node half — an empty `apply()`, present so the host Loader can import the package |
| `lib/client.js` | the browser bundle the shell loads |
| `lib/types/**/*.d.ts` | type declarations |

## Install into a profile

`pnpm run stage` copies the built artifacts into `~/.dsh/plugins/model-aid` and writes a
dependency-free manifest there. Then point a profile at it:

`~/.dsh/profiles/<name>/package.json`

```json
{
  "dependencies": {
    "model-aid": "link:C:/Users/<you>/.dsh/plugins/model-aid"
  }
}
```

`~/.dsh/profiles/<name>/cordis.patch.yml`

```yaml
- insert:
    - id: model-aid
      name: 'model-aid'
```

Restart the host, then open **Model specs** in the sidebar.

Use `node scripts/stage.mjs --out <dir>` to stage somewhere else.

## How the browser bundle is shaped

The shell loads a client plugin's `lib/client.js` itself, so the artifact has to match a
contract this project cannot change from the outside:

- CommonJS wrapped in `window.__ModuleLoader__.load({ id, factory })`. The shell hands the
  factory a `require` bound to its own module table.
- The nine specifiers in `SHARED_MODULES` (`tsdown.config.ts`) stay imports, so the plugin
  shares React, Cordis, and the ui-primitives / ui-slots / client-store runtime identities
  with the shell rather than inlining private copies.
- Every other bare specifier is inlined. A `require` the module table cannot answer would
  throw when the factory runs.
- `*.module.css` is compiled at build time by lightningcss and injected as a tagged `<style>`
  when the factory executes, default-exporting the hashed class map the components import.

The `model-aid-bundle-purity` tsdown plugin rejects any other `@deepseek-ai/` value import at
build time. Cross-plugin behaviour goes through Cordis services and slots, not imports.

## Layout

```
src/index.ts                 node half (empty apply)
src/client/index.ts          apply(): sidebar entry + main panel + change subscriptions
src/client/catalog-service.ts browser-side catalog read, TTL cache, single-flight
src/client/catalog.ts        models.dev document parsing and indexing (zod)
src/client/match.ts          configured route/model → catalog entry, and the fuzzy search
src/client/configured.ts     settings namespaces → configured routes and models
src/client/comparison.ts     differences between stored and published values; write ops
src/client/add-model.ts      default template, the appending edit, and the draft rules
src/client/store.ts          panel state, write planning, write execution
src/client/ModelsDevPage.tsx the page
src/client/AddModelDialog.tsx the add-model dialog
src/client/locales.ts        zh + en dictionaries
tests/                       173 specs
```
