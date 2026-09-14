# Development

The repository uses Node 24 and pnpm. Do not update generated policy output without reviewing the native tool behavior that produced it.

## Verification commands

```sh
pnpm verify
pnpm build:launcher
pnpm docker:build
pnpm integration
pnpm capture <adapter-id> <fixture-directory>
```

| Command | Purpose |
| --- | --- |
| `pnpm verify` | Runs type checking, linting, tests, and the bundle build. |
| `pnpm build:launcher` | Builds the npm launcher package. |
| `pnpm docker:build` | Builds the local analysis image. |
| `pnpm integration` | Exercises the TS, PHP, Python, web, Drupal, Payload/Next, and monorepo fixture repositories plus deliberate mutations against a locally built image. |
| `pnpm capture …` | Captures a selected adapter's native output from a pinned image tool for parser tests. |

On its first run, integration installs fixture dependencies through the image. Native-output fixtures preserve the actual supported tool format and feed adapter parser tests.

## Tool-version bump procedure

A tool bump changes policy:

1. Change the pin in `src/registry.ts` and the image build definition.
2. Build an image containing exactly that tool and capture fresh native-output fixtures.
3. Run unit tests, integration tests, and `doctor`.
4. Build and release the new image tags.
5. Ask consumers to review the change, remove affected snapshots, and run `check --initialize`.

Ordinary `--update` does not cross a tool-version gate. The project does not use Renovate for v1, and `doctor` is the final authority for versions in a built image.

## Version changes

A version bump updates these three locations together:

- root `package.json`;
- `launcher/package.json`; and
- the CLI version literal in `src/cli/version.ts`.

A test enforces version agreement. Launcher X.Y.Z runs image vX.Y.Z, and the release workflow verifies that a `vX.Y.Z` tag matches the launcher version before publishing.

## Release sequence

1. Merge the release change with a merge commit; the repository accepts merge commits only.
2. Create the protected `vX.Y.Z` tag.
3. The release workflow verifies `tag == launcher version`.
4. The workflow publishes the image as both `vX.Y.Z` and the floating `vX` tag.
5. It stages the npm launcher from `launcher/` with trusted publishing and `npm stage publish`.
6. A maintainer reviews and approves the staged package with 2FA.

The trusted publisher has stage-only permission. Approve from the npm package page or from the command line:

```sh
npm stage list @runroom/code-quality
npx npm@11.19.0 stage approve <id>
```

Staging requires npm 11.15 or newer; the release job installs a supported npm version explicitly. npm provenance is not available while the repository is private.

The first package version cannot use staging. Build the launcher from the repository root with `pnpm build` or `pnpm build:launcher`:

```sh
pnpm build:launcher
```

Then publish from `launcher/` and configure the npm trusted publisher for repository `Runroom/code-quality` and workflow `release.yml`:

```sh
cd launcher
npm publish --access public
```

Protected tags prevent replacement of a published release line. Breaking CLI, snapshot, parser, policy, or reusable-workflow contracts start a new major version.
