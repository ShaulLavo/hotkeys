# Development and releases

## Prerequisites

Use the pinned Bun 1.4.4 and Node 24 or newer for development. Published package runtime declarations remain Node 20 or newer. CI runs on hosted Ubuntu with Node 24, Bun's download cache, and a committed `bun.lock`.

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` builds each package once through Turbo, checks types and typed README examples, lints, checks formatting, runs both Vitest suites, packs the built output, and installs it with npm and Bun into separate fresh consumers outside this workspace. That consumer checks Node imports, React server rendering, one shared core instance, and exported declarations. Temporary staging and consumer directories are removed in `finally` blocks.

The Vitest and mocker patches in `patches/` travel with this repository. They are needed for the pinned test tools. The browser-playwright patch from Fregat is absent because these suites use happy-dom.

## Install

This repository contains two packages. Use the per-package release tarballs, which include JavaScript and declarations. A Git dependency on the repository root resolves the private workspace manifest.

No standalone release has been published by this preparation PR. After the owner approves the switch, copy the full commit from a published release into `revision`:

```sh
revision='<full 40-character hotkeys commit from the published release>'
base="https://github.com/ShaulLavo/hotkeys/releases/download/hotkeys-$revision"
bun add "@fregat/hotkeys@$base/fregat-hotkeys-$revision.tgz"
# For React apps, also supply react and react-dom 18 or newer:
bun add "@fregat/react-hotkeys@$base/fregat-react-hotkeys-$revision.tgz"
```

npm can install the same named URLs. Commit your lockfile. The React adapter declares the core as an exact-version peer, so the app supplies its core copy. Install both packages from the same full commit. Singapore, ghostty-webgpu and their consumers should select that same core URL so they share its registry. The install requires no source build, Git checkout, lifecycle scripts or npm publishing credentials.

## Work on a local checkout

Build this checkout with `bun run build`. In a consuming Bun project, temporarily replace its hotkeys dependency with `file:/absolute/path/to/hotkeys/packages/hotkeys`. If it uses the React adapter, also select `file:/absolute/path/to/hotkeys/packages/react-hotkeys`. For other linked packages that depend on hotkeys, temporarily select that same local core in their manifests and install their dependencies too. This also keeps the React adapter on the supplied core peer. Run `bun install` and rebuild hotkeys after edits. Keep these temporary manifest and lockfile changes uncommitted; restore the pinned release dependencies before the consumer PR.

Consumers read the local package's existing `dist` exports. Source-aware dev servers may additionally map the linked checkout's source and watch it; the consuming app owns that configuration. Fregat's current source mapper needs a separate change to accept installed release packages before it switches over.

## Prepare a release

Package versions stay unchanged in feature PRs. At release time, advance both packages together with a patch version, update the React adapter's exact core peer version and both changelogs, refresh `bun.lock`, and merge that reviewed change. The full commit in the artifact names distinguishes builds at the same package version.

After approval, tag the selected clean main commit with a lightweight tag and push it:

```sh
revision=$(git rev-parse HEAD)
git tag "hotkeys-$revision" "$revision"
git push origin "hotkeys-$revision"
```

The tag workflow calls the same CI job. It downloads those exact verified artifacts in a second job and creates a **draft** GitHub Release with two tarballs, `manifest.json`, and `SHA256SUMS`. The tag must equal `hotkeys-<full commit>`. A maintainer reviews and publishes that draft before any consumer changes its pin. Never move a published tag or replace its assets. `bun run pack` prepares the same files locally in ignored `release/` after a build; it never publishes anything.

## Contribute

Changes belong in this repository after the owner enables the standalone project. The preparation PR removes the automatic mirror-PR closer. Until that change reaches main, that old workflow can still close new PRs. Repository settings, mirror shutdown, and the Fregat switch remain owner actions.

Keep READMEs short; put guides in `docs/`. Retain MIT attribution. Run the narrowest relevant checks while editing, then `bun run verify` before requesting review.
