# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [Unreleased]

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
- 235 specs over the matching, the write paths, the browser-local bindings, and the
  rendered page.

[Unreleased]: https://github.com/OWNER/DSH-modelspec/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/DSH-modelspec/releases/tag/v0.1.0
[models.dev]: https://models.dev
