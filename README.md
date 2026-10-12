# DSH-modelspec

A [dsh](https://github.com/deepseek-ai/deepseek-harness) web-client plugin. It reads the
[models.dev](https://models.dev) catalog, compares it against the models this deployment
actually configured, and writes the differences back.

The panel is the **Model specs** entry in the left sidebar. One card per configured provider
route, one row per model inside it, and the stored value beside the published one wherever
they disagree. You can adopt one model's values, one route's, or the whole page at once.
Each route carries **Add model**, which looks a model up in the catalog and appends it to
that route, and each model row carries **Edit** and **Remove**, which change what one
configured model stores, which catalog entry it is compared against, or whether it is
configured at all.

Repository: [AmakiSora/DSH-modelspec](https://github.com/AmakiSora/DSH-modelspec). See
[CHANGELOG.md](CHANGELOG.md) for what has changed in each release.

## What it does

- **Compares only what you configured.** The adapter directory publishes every route an LLM
  adapter knows about — pi-ai alone ships three dozen — so a route appears only when its
  settings namespace resolves a profile that declares at least one model.
- **Never writes a preset.** A route the adapter ships itself (`deepseek-official`,
  `deepseek-account`, pi-ai's own catalog routes) is compared but never written. The rule is
  the directory's own `declared` answer, not a list of names, so it tracks whatever the
  installed DSH considers a preset. A preset route offers no **Add model** or **Edit** button
  either.
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

## Editing a model

**Edit** at the right of a model row opens the same picker over one model that already exists.
The two changes it offers are one decision: choose which catalog entry the model follows, and
edit the values it stores. Repointing without taking that entry's values would leave the row
reporting a difference you just refused to adopt, so choosing an entry fills the fields from it
exactly as it does when adding.

**The entry source is a panel preference, not deployment configuration.** The settings document
validates every write against the adapter's own schema, which declares no field for it, so a
binding cannot be stored in the namespace and is kept in this browser's local storage instead —
keyed by host, route, and model id, so two deployments on one machine stay apart and reordering
a route's models does not re-point anything. It decides what the model is compared against and
never what is written. A pinned entry the catalog no longer publishes falls back to the
automatic match rather than leaving the model unmatched, and a row whose entry was pinned says
so beside it.

**Clearing a field hands it back to the adapter.** Adopting a catalog entry can only ever write
a value the catalog publishes; an edit can also clear one, and the settings document answers
that with an `unset` — the field returns to whatever the adapter or composition base declares,
which is the only meaning "unset" has for a value the deployment may never have written itself.
Only fields the edit actually changed are written, so repointing a model at another entry
without touching a field writes nothing at all.

## Removing a model

**Remove** is the one control with no shortcut back: it takes the entry out of the
deployment's configuration, and putting it back means adding it again. It is an icon rather
than a text button, and it asks first — the confirmation names the model, says whether the
provider keeps other models, and warns that removing a provider's only model takes the
provider off the panel entirely.

The settings document has no delete verb, so the write is an `unset` at the array index —
the one edit that takes an element out and shifts the ones behind it. The panel therefore
re-reads its rows afterwards instead of trusting the index it held when the button was
pressed, and the namespace revision guards the write against another window having reordered
the array underneath. The entry binding goes with the model it described rather than lingering
as hidden state for an id the route no longer stores.

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

`pnpm run stage` copies the built artifacts into `~/.dsh/plugins/dsh-modelspec` and writes a
dependency-free manifest there. Then point a profile at it:

`~/.dsh/profiles/<name>/package.json`

```json
{
  "dependencies": {
    "dsh-modelspec": "link:C:/Users/<you>/.dsh/plugins/dsh-modelspec"
  }
}
```

`~/.dsh/profiles/<name>/cordis.patch.yml`

```yaml
- insert:
    - id: dsh-modelspec
      name: 'dsh-modelspec'
```

The three names are one identity: the staged manifest's `name` is the dependency key, the
staged directory is the path that key points at, and the plugin registers itself under the
name `tsdown.config.ts` hardcodes. Rename all three together or the profile and the bundle
stop agreeing.

Earlier installs of this panel were named `model-aid`. After renaming, a profile's
`package.json` and `cordis.patch.yml` need the new key and id, and the old
`~/.dsh/plugins/model-aid` directory is no longer read. Entry sources a browser had pinned
under the old name are carried across on first use, so nothing is silently unpinned.

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

The `dsh-modelspec-bundle-purity` tsdown plugin rejects any other `@deepseek-ai/` value
import at build time. Cross-plugin behaviour goes through Cordis services and slots, not
imports.

## Releasing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
which is what makes the next version mechanical to read off the history:

| Commit | Version bump |
| --- | --- |
| `fix: …` | PATCH |
| `feat: …` | MINOR |
| `feat!: …` or a `BREAKING CHANGE:` footer | MAJOR |

Other types (`docs:`, `refactor:`, `test:`, `chore:`, …) carry no bump on their own. A scope
may follow the type — `feat(picker): …` — to name the part of the codebase a change belongs
to.

Each release then gets a section in [CHANGELOG.md](CHANGELOG.md) written for a reader rather
than generated from the log: the `Added` / `Changed` / `Fixed` / `Removed` categories from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), an ISO date, and a `vX.Y.Z` tag.

The project is on `0.y.z`, which under [Semantic Versioning](https://semver.org/) means the
public API is not promised stable yet — fitting for a plugin built against a `0.2.1-alpha`
of dsh. `1.0.0` is the release to make once the panel's behaviour has been relied on.

## Layout

```
src/index.ts                 node half (empty apply)
src/client/index.ts          apply(): sidebar entry + main panel + change subscriptions
src/client/catalog-service.ts browser-side catalog read, TTL cache, single-flight
src/client/catalog.ts        models.dev document parsing and indexing (zod)
src/client/match.ts          configured route/model → catalog entry, and the fuzzy search
src/client/configured.ts     settings namespaces → configured routes and models
src/client/comparison.ts     differences between stored and published values; write ops
src/client/bindings.ts       which catalog entry each model follows, kept in this browser
src/client/add-model.ts      default template, the appending edit, and the draft rules
src/client/store.ts          panel state, write planning, write execution
src/client/ModelsDevPage.tsx the page
src/client/ModelPicker.tsx   the id field, candidate chooser, and field block both dialogs share
src/client/AddModelDialog.tsx the add-model dialog
src/client/EditModelDialog.tsx the edit-model dialog
src/client/RemoveModelDialog.tsx the removal confirmation
src/client/locales.ts        zh + en dictionaries
tests/                       the specs: matching, write paths, bindings, and the page
CHANGELOG.md                 one section per release, written for a reader
AGENTS.md                    the versioning, commit and changelog conventions
LICENSE                      MIT
```

## License

MIT — see [LICENSE](LICENSE).
