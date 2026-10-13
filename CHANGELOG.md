# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [Unreleased]

## [0.3.0] - 2026-10-13

### Added

- **Add model** can ask the route's own provider which models it serves. A button beside the id
  field interrogates the endpoint the route is configured with — `{baseURL}/models` for an
  OpenAI-compatible protocol, the Messages listing for an Anthropic one — and offers every id it
  answers with, so a model can be added without knowing its id in advance. A search field narrows
  that listing by id or name, which matters where the provider serves dozens of models, and the
  query is dropped when a fresh listing arrives rather than hiding the new answer behind it. The
  question is put to the Host rather than the browser: an adapter answers from its own catalog for
  a route it already describes, and otherwise reaches the endpoint with the route's own stored
  credential, which never leaves the Host. An id the endpoint lists that the route already
  configures is shown and marked rather than offered, because the write would refuse it.
- Taking an id from that listing fills the fields with what the endpoint disclosed — name,
  context length, output cap, accepted input types — and asks models.dev about the same id, so the
  comparison, the fuzzy search, and the entry choice stay available for a model the catalog has
  never heard of. The two answers are ranked rather than merged: an entry models.dev publishes
  wins once one is chosen, because that entry is what the row is compared against, and a field
  neither of them published is left to the adapter.

### Fixed

- The add-model and edit-model dialogs are wider, and they are capped against the window rather
  than growing past it. Both hold a chooser and four fields, and a provider listing fifty models —
  or a fuzzy search answering with a dozen entries — used to make a card taller than a short
  window; a centered card that tall is clipped at the top and the bottom, which puts the title and
  the actions out of reach with nothing to scroll. The card is capped, its body is the region that
  scrolls, and each chooser caps at 30% of the window's height as well as at its own 200px.

## [0.2.0] - 2026-10-13

### Added

- An MIT `LICENSE` file. The package manifest declared MIT from the start, but the text
  itself was missing, and a manifest field with no file behind it grants nothing.
- A bundle layer, so the plugin installs the way dsh installs a plugin: the package declares
  `dsh.bundle.patch` and ships the `cordis.patch.yml` that inserts its own row. Selecting the
  bundle is now the whole installation — no patch written by hand, and the patch travels with
  the package instead of being retyped into each profile.
- A `prepublishOnly` build, so the tarball published to the registry cannot be one built from
  an older source tree.

### Changed

- The package is publishable: `private` is gone, and `files` ships both runtime artifacts and
  the bundle patch alongside them.
- **A profile that installed an earlier release must not keep its hand-written insert.** The
  shipped patch inserts the same row, so a profile with both the bundle selected and
  `- insert: - id: dsh-modelspec` written into `cordis.patch.yml` composes the row twice.
  Keep one: select the bundle, or keep the manual pair and leave the bundle unselected.
- `pnpm run stage` now stages `cordis.patch.yml` too, and the staged manifest carries the
  package's own `dsh` section rather than a hand-copied one.

## [0.1.0] - 2026-10-12

First release. Built against dsh `0.2.1-alpha.2`.

### Added

- A **Model specs** sidebar panel: one card per configured provider route, one row per
  model, with the stored value beside the published one wherever they disagree.
- Comparing the deployment's configured models against the [models.dev](https://models.dev)
  catalog, in one Remote call per read. Every match reports the comparison that found it,
  and a model with no catalog entry is reported as unmatched rather than guessed at.
- Adopting the published values of one model, one route, or every route on the page.
- **Add model** on a route: type a model id, and the panel matches it against the catalog,
  offers every entry it reaches when the id is ambiguous, and appends the chosen entry to
  the route's namespace.
- A fuzzy search beside the model id, for ids that came close rather than matched: a
  mistyped character, a truncated paste, a dated variant. Each result is labelled with why
  it was offered.
- **Edit** on a model row: change the values it stores, and choose which catalog entry it
  is compared against. A pinned entry is remembered in the browser per host, route and
  model id, since the deployment's schema declares no field for it.
- **Remove** on a model row, behind a confirmation that names what it takes out and what
  happens to the rest of the route.
- Simplified Chinese and English dictionaries for the whole panel.
- Specs over the matching, the write paths, the browser-local bindings, and the rendered
  page.

[Unreleased]: https://github.com/AmakiSora/DSH-modelspec/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/AmakiSora/DSH-modelspec/releases/tag/v0.3.0
[0.2.0]: https://github.com/AmakiSora/DSH-modelspec/releases/tag/v0.2.0
[0.1.0]: https://github.com/AmakiSora/DSH-modelspec/releases/tag/v0.1.0
[models.dev]: https://models.dev
