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

- **Fetch available models.** A button beside the id field asks the route's own provider what it
  serves, so a model can be added without knowing its id in advance. The question goes to the
  Host, which is where the answer is: an adapter that already describes the route answers from
  its own catalog without touching the network, and a gateway or self-hosted route is
  interrogated at the endpoint its profile declares — `{baseURL}/models` for an
  OpenAI-compatible protocol, the Messages listing for an Anthropic one — using the route's
  stored credential, which never reaches the browser. Every id the endpoint answers with is
  offered with what it disclosed about name, context, output, and input types; one the route
  already configures is shown and marked rather than offered. Taking an id fills the fields and
  asks models.dev about it, so the comparison below stays in play. A field the endpoint stayed
  silent about is left to the adapter, and a name that only repeats the id is not stored.
- **One entry matched.** The published values fill the fields and the dialog names the
  comparison that found it.
- **Several entries matched.** Every one is offered, with the provider it came from and the
  capacities it publishes, and nothing is chosen until you pick. The same precedence a
  comparison uses decides which entries are offered at all: the resolved provider first, then
  every provider, and a loose comparison only once the precise ones found nothing. An entry
  chosen here replaces whatever the endpoint disclosed, because that entry is what the row will
  be compared against.
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
packages at that version and relies on the web shell's client module table. Installing it needs a
profile whose app supplies the plugin manager — the shipped `@deepseek-ai/dsh-base` plus web app
do — because the plugin is installed as a bundle rather than by editing the profile by hand.

## Build

```sh
pnpm install
pnpm run build      # tsc emits lib/types, tsdown emits lib/index.js and lib/client.js
pnpm run test
pnpm run typecheck
pnpm run lint
```

`pnpm run build` produces the runtime artifacts, and `cordis.patch.yml` ships beside them as it
is written:

| File | Role |
| --- | --- |
| `lib/index.js` | node half — an empty `apply()`, present so the host Loader can import the package |
| `lib/client.js` | the browser bundle the shell loads |
| `lib/types/**/*.d.ts` | type declarations |
| `cordis.patch.yml` | the bundle layer: the one row a profile composes |

## Install into a profile

The package is a dsh **bundle**. It declares `dsh.bundle.patch` and ships the `cordis.patch.yml`
that inserts its own row, so installing it selects the layer that puts the panel in a profile's
composition, and no patch is written by hand.

Install `dsh-modelspec` from the Web sidebar's **Plugins** page. The `plugin_manager` tool's
`install_bundle` and the `dsh plugin` command do the same thing, from a name, a path, a tarball,
or a git address. Then open **Model specs** in the sidebar; a live profile recomposes on its own,
a startup-only one needs a restart.

**Selecting the bundle and writing the insert by hand are alternatives, not steps.** A profile
that has an `- insert: - id: dsh-modelspec` block of its own — every install before this bundle
layer existed — composes the row a second time once the bundle is selected. Remove the block, or
leave the bundle unselected.

### A local build instead

`pnpm run stage` copies the artifacts and the patch into `~/.dsh/plugins/dsh-modelspec` and
writes a dependency-free manifest there. That directory is what `install_bundle` accepts as a
path; a profile can also be pointed at it by hand:

`~/.dsh/profiles/<name>/package.json`

```json
{
  "dependencies": {
    "dsh-modelspec": "link:C:/Users/<you>/.dsh/plugins/dsh-modelspec"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-modelspec"]
    }
  }
}
```

Four names are one identity: the staged manifest's `name` is the dependency key, the staged
directory is the path that key points at, `tsdown.config.ts`'s `PACKAGE` is the id the browser
bundle registers under, and the shipped patch's inserted row is the entry a profile composes.
Rename them together or the profile and the bundle stop agreeing; a profile that already
installed the plugin needs its dependency key and bundle selection updated by hand.

Earlier installs of this panel were named `model-aid`. After renaming, a profile's
`package.json` and `cordis.patch.yml` need the new key and id, and the old
`~/.dsh/plugins/model-aid` directory is no longer read. Entry sources a browser had pinned
under the old name are carried across on first use, so nothing is silently unpinned.

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

Publishing is the tag push: `.github/workflows/publish.yml` runs the specs, checks that the tag
names the version in `package.json`, and publishes from the runner — which is not behind the
network the registry is unreachable from here. Running `pnpm publish` in a terminal does the same
thing when the registry *is* reachable. Either way `files` decides what the tarball carries and
`prepublishOnly` rebuilds before it is packed, so a version cannot be published from a stale
`lib/` — the mistake that ships a manifest whose imports do not exist. The workflow needs one
repository secret, `NPM_TOKEN`: a granular token with **bypass 2FA** enabled, since a run cannot
answer a one-time-password prompt. The version in `package.json`, the changelog section
describing it and the tag are the same number;
[tests/release.spec.ts](tests/release.spec.ts) is that checklist, executable.

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
cordis.patch.yml             the bundle layer: the row a profile composes
tests/                       the specs: matching, write paths, bindings, and the page
.github/workflows/publish.yml the tag push that publishes the version to npm
CHANGELOG.md                 one section per release, written for a reader
AGENTS.md                    the versioning, commit and changelog conventions
LICENSE                      MIT
```

## License

MIT — see [LICENSE](LICENSE).
