# Development

This repository uses Bun workspaces (`bun@1.4.4`), Node `>=24`, Turborepo, Vitest, Oxlint, Oxfmt, Unknot, and Playwright.

## Workspace commands

Run these scripts from the repository root:

| Command                | What it runs                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build`        | Builds `@shaulavo/hotkeys` (`packages/hotkeys/scripts/build.ts` + `tsc -p tsconfig.build.json`).                                                                                                         |
| `bun run typecheck`    | Typechecks packages and runs `bun run docs:check`.                                                                                                                                                       |
| `bun run docs:check`   | Runs `bun scripts/check-samples.mjs`, typechecking every `ts` and `tsx` block in `README.md`, `packages/hotkeys/README.md`, `docs/overview.md`, and `docs/getting-started.md` against the built package. |
| `bun run lint`         | Runs `bun scripts/check-source-language.ts`, `oxlint .`, and `unknot packages/hotkeys/src`.                                                                                                              |
| `bun run format`       | Formats files in place with `oxfmt --write .`.                                                                                                                                                           |
| `bun run format:check` | Checks formatting with `oxfmt --check .`.                                                                                                                                                                |
| `bun run test`         | Runs Vitest across workspaces.                                                                                                                                                                           |
| `bun run pack`         | Runs `node scripts/pack.mjs` to create the release tarball, `release/manifest.json`, and `release/SHA256SUMS`.                                                                                           |
| `bun run test:package` | Runs `node scripts/check-package.mjs` and `node scripts/check-package.mjs --bun` against the packed tarball.                                                                                             |
| `bun run test:browser` | Runs `node scripts/check-packed-browser.ts` in Chromium against the packed tarball and `react@19.2.0`.                                                                                                   |
| `bun run verify`       | Runs `build`, `typecheck`, `lint`, `format:check`, `test`, `pack`, and `test:package` in order.                                                                                                          |

Run `bun run verify` and `bun run test:browser` before opening or merging a release-ready pull request.

## Benchmarks

Run the benchmarks from `packages/hotkeys`:

```bash
cd packages/hotkeys
bun bench/lookup.ts
bun bench/registry.ts
```

See [Performance](../packages/hotkeys/docs/performance.md) for what each script measures and current reference runs.

## Script language

Handwritten code in this repository uses TypeScript, enforced by `scripts/check-source-language.ts`. Three existing Node runners remain in an allowlist until converted to TypeScript:

- `scripts/check-package.mjs`: installed-consumer verification runner (npm and Bun).
- `scripts/check-samples.mjs`: documentation-sample typecheck runner.
- `scripts/pack.mjs`: release tarball staging and checksum runner.

Do not add new `.js`, `.mjs`, or `.cjs` source files.

## CI checks

`.github/workflows/ci.yml` runs on pull requests (`opened`, `synchronize`, `reopened`, `ready_for_review`), `workflow_dispatch`, and `workflow_call`:

1. Rejects draft pull requests.
2. Installs Bun from `package.json` and Node `24`.
3. Runs `bun install --frozen-lockfile`.
4. Runs `bun run verify`.
5. Installs Chromium (`bunx --no-install playwright install --with-deps --only-shell chromium`) and runs `bun run test:browser`.

## Verified-tarball publishing

Releases publish the exact tarball bytes produced and verified in CI, with npm provenance enabled.

### How `scripts/pack.mjs` stages the tarball

`bun run pack` builds `release/shaulavo-hotkeys-<version>.tgz` from `packages/hotkeys` as follows:

1. Reads `git rev-parse HEAD` as `revision` and `packages/hotkeys/package.json` for `version` and `files` (`dist`, `docs`, `LICENSE`, `README.md`).
2. Copies those entries into a clean staging directory along with `docs/assets` into `docs/assets`.
3. Rewrites `../../../docs/assets/` to `assets/` in staged `docs/concepts.md` and `../src/index.ts` to `https://github.com/ShaulLavo/hotkeys/blob/<revision>/packages/hotkeys/src/index.ts` in staged `docs/api.md`.
4. Strips `devDependencies` and `scripts` from the staged `package.json` and asserts that `dependencies` contain no `workspace:`, `catalog:`, `file:`, or `link:` specifiers.
5. Packs the staged directory with `npm pack --ignore-scripts --pack-destination release`.
6. Computes the tarball's SHA-256 digest and writes `release/manifest.json` (`{ revision, artifacts }`) and `release/SHA256SUMS`.

### How `.github/workflows/release.yml` publishes

The release workflow triggers on pushes to `main` that change `packages/hotkeys/package.json` or `.github/workflows/release.yml`, or via `workflow_dispatch`:

1. Queries `https://registry.npmjs.org/@shaulavo%2fhotkeys/<version>`. HTTP `200` skips publishing; HTTP `404` proceeds; any other status fails the job.
2. Runs `bun install --frozen-lockfile`, `bun run verify` (which creates and verifies `release/`), installs Chromium, and runs `bun run test:browser` against that exact tarball (re-verifying its SHA-256 before and after).
3. Uploads `release/` as the `hotkeys-npm-<sha>` workflow artifact.
4. Enters `release/`, runs `sha256sum --check SHA256SUMS`, verifies `manifest.json`'s `revision` equals `$GITHUB_SHA`, and publishes the exact tarball with `npm publish "./$tarball" --access public --provenance`.

To cut a release, bump `version` in `packages/hotkeys/package.json` in a reviewed pull request and merge to `main`.
