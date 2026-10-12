# Working in this repository

Conventions for anyone — human or agent — changing `dsh-modelspec`. They exist because
three facts about a release are stated in more than one place, and every pair is a way for
the project to quietly disagree with itself.

Read [README.md](README.md) for what the plugin does and why it is shaped the way it is.
This file is about how to change it.

## Commands

```sh
pnpm install
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # oxlint
pnpm test             # vitest run
pnpm run build        # tsc → lib/types, tsdown → lib/index.js + lib/client.js
pnpm run stage        # copy the built artifacts into ~/.dsh/plugins/<name>
```

Run `typecheck`, `lint` and `test` before every commit. `build` before staging, because
`stage` copies `lib/` and will happily copy a stale one.

## Version numbers

The project follows [Semantic Versioning 2.0.0](https://semver.org/). The version has
**one source**: the `version` field in `package.json`. `scripts/stage.mjs` reads it, so the
staged manifest cannot disagree with the package manifest, and nothing else should restate
it but the changelog and the tag.

### What the public API is

SemVer requires a project to define one before version numbers mean anything. For this
plugin that is:

- the package name and the identity the bundle registers under;
- the profile install contract: the staged manifest's shape and its `dsh.client` entry;
- the panel's user-visible behaviour, including which writes it refuses;
- the browser-local storage format behind pinned entry sources. Changing the key prefix or
  the shape orphans what a reader has already chosen, which is a breaking change even
  though no deployment configuration moves.

Everything under `src/client/` that is not one of those is internal, and may change in a
patch release.

### Which number to bump

| Change | Bump | Example |
| --- | --- | --- |
| A bug fix that changes no documented behaviour | PATCH | `0.1.0` → `0.1.1` |
| A new feature, or a documented behaviour added | MINOR | `0.1.0` → `0.2.0` |
| Anything incompatible with the list above | MAJOR | `1.2.3` → `2.0.0` |

While the project is on `0.y.z` — which it is, deliberately, until the panel's behaviour has
been relied on — SemVer leaves `y` free to break. So on `0.x` the third row moves the
**minor**, not the major:

| Change | Bump while `0.y.z` | Example |
| --- | --- | --- |
| PATCH-level | PATCH | `0.1.0` → `0.1.1` |
| MINOR-level, including a breaking one | MINOR | `0.1.0` → `0.2.0` |

`1.0.0` is a decision that the panel is worth depending on, made once and on purpose. No
single feature is allowed to roll the version into it by accident, which is why
`tests/release.spec.ts` asserts the version still starts with `0.`.

### Releasing

1. Bump `version` in `package.json`.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md` and move the `[Unreleased]`
   compare link onto the new version.
3. Commit as `chore(release): X.Y.Z`, or as the `feat:`/`fix:` commit that earned it.
4. Tag it: `git tag -a vX.Y.Z -m 'X.Y.Z'`. The tag is `vX.Y.Z`; the version is `X.Y.Z` —
   the `v` is part of the tag, not of the version.
5. `pnpm run build && pnpm run stage`.

`tests/release.spec.ts` fails when the version in `package.json` has no changelog heading,
when the changelog's compare link has not moved with it, when the entry is undated or
carries a category the format does not define, and when the bundle would register under a
name the package does not declare. It is the checklist, executable.

## Commit messages

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- **Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`,
  `style`. Only `feat` and `fix` move the version on their own; the rest carry no bump.
- **Description**: imperative mood, lower case, no trailing full stop. It completes the
  sentence "this commit will …".
- **Scope** names the part of the codebase, e.g. `feat(picker): …`, `fix(bindings): …`. Use
  one when it adds information, not on every commit.
- **Body**: why the change is right, not what the diff does. The diff is already there.
  Record a constraint that is invisible in the code — a threshold that was chosen rather
  than derived, a document format that only accepts one edit shape, a decision that looks
  arbitrary and is not.
- **Breaking changes** are marked by `!` after the type or scope (`feat!: …`), and described
  under a `BREAKING CHANGE:` footer. Both, not either, when the change is worth a reader's
  attention.

One logical change per commit — and a commit that conforms to two types was two commits that
did not get separated. The history here has one, carrying both a fuzzy search and a
per-model editor: its message has to describe two unrelated features, and a reader scanning
the log cannot tell which change belongs to which.

## Changelog

[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), in `CHANGELOG.md`.

- It is written for a reader, not generated from `git log`. A commit describes a step in the
  work; an entry describes what changed for somebody using the panel.
- Sections are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Omit the
  ones with nothing in them rather than leaving them empty.
- Newest release first, each with an ISO `YYYY-MM-DD` date.
- Keep `## [Unreleased]` at the top and record work there; at release time it becomes the
  new version's section.
- List deprecations, removals and breaking changes even when little else changed — those are
  the entries somebody upgrades to read.

## Names

The package name lives in `package.json`, and the identity the bundle registers under is
declared in `tsdown.config.ts` as `PACKAGE`. Those are two facts, not one: the registration
id is the plugin's runtime identity, and a package published under an npm scope must not
silently rename the plugin every existing profile refers to. `tests/release.spec.ts` asserts
they are equal, so they cannot drift apart unnoticed.

Renaming is therefore a coordinated change, and four things move together:

1. `package.json`'s `name`;
2. `PACKAGE` in `tsdown.config.ts`;
3. the storage prefix in `src/client/bindings.ts` — and the old prefix must stay readable,
   or every entry a reader has pinned is silently lost;
4. the install instructions in `README.md`.

`scripts/stage.mjs` follows the package name on its own. A profile that already installed
the plugin needs its `package.json` dependency key and its `cordis.patch.yml` id updated by
hand; say so in the changelog.

## Do not break these

Each is a constraint the code cannot express on its own, and each has cost somebody a
release to learn.

- **An adapter preset route is never written**, and that includes adding and removing models
  on it. The rule is the directory's `declared` answer, not a list of names.
- **A model is appended at the user layer's array length**, not the resolved view's. A
  settings edit lands on the user section and is merged over the resolved one, so the
  resolved length can name an index that section does not have.
- **A cleared field is an `unset`**, which the settings document answers by handing the field
  back to the adapter. Adopting a catalog entry can never do that.
- **A pinned entry source is a panel preference**, kept in the browser. It must never reach a
  namespace: the schema declares no field for it, and a write carrying one is refused.
- **The browser bundle imports nothing cross-plugin.** `SHARED_MODULES` in `tsdown.config.ts`
  is the whole list of specifiers the shell answers; the purity plugin rejects the rest at
  build time.
- **Components hold no Host access.** Host reads and writes live in `src/client/store.ts`;
  a component receives plain data and callbacks.

## Layout

`README.md` ends with a file-by-file map. The short version: `store.ts` owns state and
writes, `match.ts` and `catalog*.ts` own the catalog, `comparison.ts` and `add-model.ts` own
the edits, and the `.tsx` files render what they are handed.
