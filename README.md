# Runroom code-quality

## What it is

Runroom code-quality is a Dockerized, incremental quality gate for TypeScript/JavaScript, PHP, and Python repositories. It runs pinned complexity, cognitive-complexity, exact-duplication, unused-code, and optional architecture checks. Findings are stored as reduction-only baselines, so an existing codebase can adopt the gate without first fixing every historical issue while new or worsened issues still block a change.

The policy is fixed in the image. Consumer repositories choose languages, source paths, exclusions, disabled checks with a written reason, and architecture rule files; thresholds and parser behavior are not configurable. See the [quality-gate reference](docs/quality-gate.md) for the complete policy and tool matrix.

## Adopt in an existing repo

From the root of the repository, run:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 init
```

Review the generated `.code-quality.yml`, source paths, `.github/workflows/quality.yml`, and `Makefile`. Commit the `quality/` baselines along with the reviewed configuration. Existing findings are recorded once; later checks fail on new or worsened findings and on stale baseline entries.

If the repository is PHP, install its application dependencies before checking. The normal CI setup is `composer install`, which creates the `vendor/` directory required by the PHP unused-code checks.

## Adopt in a new repo

Run the same `init` command from the new repository root after its first source and manifest files are present:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 init
```

Review the detected languages and paths, then commit `.code-quality.yml`, `quality/`, and the generated caller workflow from the first commit. A new repository normally starts with empty or very small baselines and receives the same gate as it grows.

`init` does not invent architecture rules. Copy and review the starter templates in [quality-gate.md](docs/quality-gate.md) when architecture conventions are ready.

## Local use

The main local command is:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check
```

The generated Makefile provides `make quality` for that check and `make quality-baseline` for a reviewed local reduction-only refresh. The CLI also provides:

- `check [checks...]` to run blocking checks;
- `baseline` to refresh existing baselines only when there is no regression;
- `report` for advisory health, duplication, and complexity reports;
- `versions` to print every pinned binary and library;
- `doctor` to verify installed versions and grammar assets.

Use `check --initialize` once for a new check or after reviewing a tool/configuration mismatch; it refuses to replace an existing snapshot. `init` creates missing baselines and keeps existing ones, reporting each kept file as `Kept existing: quality/<adapter-id>-baseline.json`.

## CI

The generated caller uses the reusable workflow pinned to the v1 contract:

```yaml
name: quality
on: [pull_request, push]
permissions: { contents: read, packages: read }
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
```

The caller can provide the supported inputs. For example, this selects checks, installs PHP dependencies, selects the v1 image explicitly, and checks a consumer subdirectory:

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `image-tag` | string | `v1` | Tag pulled from the fixed `ghcr.io/runroom/code-quality` registry |
| `checks` | string | empty | Space-separated lowercase check IDs; empty runs all detected checks |
| `setup` | string | empty | Consumer shell command run before checking |
| `working-directory` | string | `.` | Consumer working directory inside `/work` |

```yaml
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
    with:
      checks: "complexity duplication unused"
      setup: composer install --no-interaction
      image-tag: v1
      working-directory: "."
```

The reusable job checks out the full history, runs the optional setup command, invokes plain `code-quality check`, and uploads `artifacts/quality/` for 14 days. It never passes `--update` or `--initialize`, so CI never writes baselines. Knip and the PHP unused checks need installed dependencies before they run: use `setup: pnpm install --frozen-lockfile` for pnpm, `setup: npm ci` for npm, or `setup: composer install` for Composer. The first two create `node_modules/` for Knip; Composer creates `vendor/` for the PHP unused checks.

## Check selection

With no arguments, `check` runs all detected and enabled checks. Pass logical IDs to select a subset, for example:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check complexity duplication
```

The IDs are `complexity`, `cognitive`, `duplication`, `unused`, and `architecture`. A check can be disabled in `.code-quality.yml` only with a non-empty review reason. Architecture is skipped when no conventional or explicitly configured rules file exists.

## Baselines

Each concrete adapter owns `quality/<adapter-id>-baseline.json`. A snapshot records the schema version, exact tool stamp, configuration hash, and positive finding counts. Findings use stable structural anchors instead of line numbers; exact duplication uses the native jscpd fingerprint as its identity.

Initialize a check once with `check --initialize` after reviewing its current findings. Plain `check` fails when a finding is new or its value increased. A finding that disappears or decreases is marked stale and also fails until the baseline is refreshed. `baseline` is a local reduction-only update: it writes a tighter snapshot only when there is no regression. A tool-version or configuration-hash mismatch is an explicit regeneration event; review the change, remove the affected snapshot, and run `check --initialize`. CI refuses all baseline-writing modes.

## Artifacts

Each run writes to `artifacts/quality/<adapter>/`. The directory contains the native `stdout.log` and `stderr.log`, generated/native reports where a tool provides them, `comparison.json` with regressions and stale entries, and `summary.md`. The reusable workflow uploads the quality directories even when the check fails, and the CLI appends summaries to `GITHUB_STEP_SUMMARY` when that environment variable is provided.

## Configuration reference

`.code-quality.yml` accepts only these fields. Unknown fields and threshold-like settings are errors; thresholds are not configurable.

| Field | Type | Default and constraints |
| --- | --- | --- |
| `languages` | list of `ts`, `php`, `python` | All languages detected from manifests; an explicit list selects a subset |
| `paths.ts` | list of repository-relative directory/file globs | Existing `src/` when TS/JS is detected |
| `paths.php` | list of repository-relative directory/file globs | Existing `src/`, plus existing `lib/` and `app/` when PHP is detected |
| `paths.python` | list of repository-relative directory/file globs | Existing `src/` when Python is detected |
| `exclude` | list of repository-relative glob patterns | No consumer exclusions; built-in test exclusions still apply to duplication |
| `checks.disabled` | list of `{ id, reason }` objects | No checks disabled; `reason` must be non-empty prose |
| `architecture.ts.rulesFile` | repository-relative file path | `.dependency-cruiser.cjs` when it exists; otherwise skipped |
| `architecture.php.rulesFile` | repository-relative file path | `deptrac.yaml` when it exists; otherwise skipped |
| `architecture.python.rulesFile` | repository-relative file path | `.importlinter` when it exists; otherwise skipped |

An explicitly configured architecture file that is missing is an error. Consumer exclusions apply to applicable checks, while tests remain excluded from duplication regardless of the consumer paths.

## Version pinning

Pin consumers to the major image tag `ghcr.io/runroom/code-quality:v1` and the reusable workflow reference `Runroom/code-quality/.github/workflows/quality.yml@v1`. The image carries the exact v1 tool matrix documented in [quality-gate.md](docs/quality-gate.md#v1-tool-pins); the workflow accepts only an `image-tag`, while the registry and repository remain fixed.

## Security notes

Consumer code executed by dependency-cruiser configuration, import-linter imports, or a setup command such as `composer install` runs inside the job container. Tool processes receive an environment allow-list plus tool-specific values rather than the complete parent environment. Consumer paths reject option-like values, colons, absolute paths, and parent-directory traversal. The reusable workflow fixes the image registry and repository to `ghcr.io/runroom/code-quality` and accepts only the tag.

Accepted v1 supply-chain limitations are that global npm packages' transitive dependencies and Python packages are pinned only at the top level. Composer dependencies are fully locked, and downloaded phars are pinned and checksum-verified.

## Tool-version bump procedure

A tool bump changes policy and requires an explicit review:

1. Change the pin in `src/registry.ts` and the image build definition.
2. Capture fresh native-output fixtures from an image containing exactly that tool.
3. Run unit and integration tests plus `doctor`.
4. Build and release the new image tags.
5. Have consumers review and explicitly regenerate affected snapshots; do not use ordinary `--update` to cross a tool-version gate.

The project does not use Renovate for v1. `doctor` is the final authority for the exact versions in a built image.

## Development

The repository uses pnpm and Node 24. Useful commands are:

```sh
pnpm verify
pnpm docker:build
pnpm integration
pnpm capture <adapter-id> <fixture-directory>
```

`pnpm verify` runs typecheck, lint, tests, and the bundle build. `pnpm integration` expects a locally built image and exercises the three fixture repositories plus deliberate mutations. Native fixture capture is performed against a pinned image tool and is used by adapter parser tests.
