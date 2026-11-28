# Development and releases

## Prerequisites

Install Bun 1.4.4 and Node 24 or newer for local development and CI. The published `packages/hotkeys/package.json` currently declares `engines.node` as `>=20`.

Run the full verification suite from the repository root:

```sh
bun install --frozen-lockfile
bun run verify
```

`bun run verify` runs these steps in order:

1. `bun run build` compiles `@shaulavo/hotkeys` and its four entrypoints (`.`, `./react`, `./terminal`, `./adapter`) through Turbo and emits `.d.ts` files and linked `.js.map` source maps with embedded TypeScript and TSX source text.
2. `bun run typecheck` checks package types and runs `bun run docs:check` (`scripts/check-samples.mjs`) to compile every `ts` and `tsx` snippet in `README.md`, `packages/hotkeys/README.md`, `docs/overview.md`, and `docs/getting-started.md` against the built package.
3. `bun run lint` runs `scripts/check-source-language.ts` and `oxlint .`.
4. `bun run format:check` runs `oxfmt --check .`.
5. `bun run test` runs the Vitest suite in `packages/hotkeys`.
6. `bun run pack` builds a tarball in `release/` along with `manifest.json` and `SHA256SUMS`.
7. `bun run test:package` installs that tarball with npm and Bun into separate fresh directories outside the workspace and verifies exports, server rendering of the React hooks without a DOM, declarations, and source maps.

Keep the Vitest patches in `patches/` committed. Browser tests run under happy-dom, and React server-rendering tests run in Node without browser globals.

## Install

Install `@shaulavo/hotkeys` from npm:

```sh
bun add @shaulavo/hotkeys
```

For npm, run `npm install @shaulavo/hotkeys`.

If your app imports `@shaulavo/hotkeys/react`, also install its optional peer dependencies: `react` (18 or newer), `react-dom` (18 or newer), and `@tanstack/react-store` (`^0.11.1`). All four subpaths ship inside `@shaulavo/hotkeys`, so consumers install one package and share one core instance automatically.

## Work on a local checkout

To test uncommitted changes from another project:

1. Build this repository with `bun run build`.
2. In the consuming project's `package.json`, point `@shaulavo/hotkeys` at `file:/absolute/path/to/hotkeys/packages/hotkeys`.
3. Run `bun install` in the consuming project and rerun `bun run build` here after edits.
4. Restore the published version before opening a PR in the consuming project.

To test the exact packed artifact locally, run `bun run pack` and install `file:/absolute/path/to/hotkeys/release/shaulavo-hotkeys-<version>.tgz`. Each build embeds TypeScript and TSX source text in its `.js.map` files so debuggers show original source without a checkout.

## Prepare a release

Leave package versions unchanged in feature PRs. Add a changeset with `bunx changeset` when a change should appear in the next release.

On every push to `main`, `.github/workflows/release.yml` runs `bun install --frozen-lockfile` and `bun run verify`, then runs `changesets/action`:

- When pending changesets exist, the workflow opens or updates a release pull request using `bunx changeset version && bun install --lockfile-only`.
- When that release pull request merges to `main`, the workflow runs `bun run release:publish` to publish `@shaulavo/hotkeys` to npm with provenance and creates a GitHub Release.

`bun run pack` creates local verification tarballs in the ignored `release/` directory and never publishes.

## Contribute

Keep `README.md` and `packages/hotkeys/README.md` at 30 lines or fewer, and place detailed guides in `docs/` or `packages/hotkeys/docs/`. Retain MIT attribution and the TanStack Hotkeys notice. Run the narrowest relevant checks while editing, then run `bun run verify` before requesting review.

## Script language

Write all new scripts and test fixtures in TypeScript. `bun run lint` runs `scripts/check-source-language.ts`, which rejects `.js`, `.mjs`, and `.cjs` files outside three legacy runners:

- `scripts/check-package.mjs`
- `scripts/check-samples.mjs`
- `scripts/pack.mjs`

Converting each runner to TypeScript and removing its exception from `scripts/check-source-language.ts` remains open cleanup work. Temporary JavaScript generated during package-consumer tests stays outside the repository.
