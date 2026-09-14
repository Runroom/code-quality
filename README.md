# Runroom code-quality

## What it is

Runroom code-quality is a Dockerized, incremental quality gate for TypeScript/JavaScript, PHP, Python, and web template/style sources. It runs pinned complexity, cognitive-complexity, exact-duplication, unused-code, and optional architecture checks. Findings are stored as reduction-only baselines, so an existing codebase can adopt the gate without first fixing every historical issue while new or worsened issues still block a change.

The policy is fixed in the image. Consumer repositories choose languages, source paths, exclusions, disabled checks with a written reason, and architecture rule files; thresholds and parser behavior are not configurable. See the [quality-gate reference](docs/quality-gate.md) for the complete policy and tool matrix.

The image uses Oxlint, Fallow, jscpd, Knip, and dependency-cruiser for TS/JS; PHPCS with Slevomat and the Runroom standard, PHPStan, deptrac, composer-unused, and composer-require-checker for PHP; and Ruff, complexipy, Vulture, deptry, and import-linter for Python.

Tests are excluded from every blocking check using the built-in test-file patterns. Generated frontend bundles (`public/build`, `*.min.js`, and `*.min.css`) and Symfony `var/` cache files are also excluded. Consumer `exclude` patterns are additive.

## Adopt in an existing repo

From the root of the repository, run:

```sh
npx @runroom/code-quality init
```

This requires Docker to be running and Node 18 or newer for `npx`. Launcher version X.Y.Z always runs `ghcr.io/runroom/code-quality:vX.Y.Z`; set `CODE_QUALITY_IMAGE` to override the image.

In GitHub Actions, use the reusable workflow rather than `npx`, because the launcher does not wire `GITHUB_STEP_SUMMARY` into the container.

Or, without Node:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 init
```

Review the generated `.code-quality.yml`, source paths, `.github/workflows/quality.yml`, and `Makefile`. `init` writes or updates:

- `.code-quality.yml`;
- `quality/<adapter>-baseline.json`;
- `.github/workflows/quality.yml`;
- `Makefile` created if absent, or extended when it exists without these targets, with `quality`, `quality-all`, `quality-baseline`, `quality-report`, and `quality-doctor` targets plus the `CODE_QUALITY_IMAGE` variable; existing quality targets, a `.PHONY` entry for them, or a custom `.RECIPEPREFIX` are left untouched and the snippet is printed instead; and
- the `.gitignore` entry used by `report --output` (`artifacts/quality/`).

Commit the `quality/` baselines along with the reviewed configuration. The directory produced by `report --output` is per-run evidence and is never committed. Existing findings are recorded once; later checks fail on new or worsened findings and on stale baseline entries.

The generated Makefile uses `$$PWD`, which is Make escaping for `$PWD`; run its targets through `make` so Make expands the variable.
Recipe lines must start with a tab; a snippet pasted from a terminal loses the tabs and fails with `multiple target patterns`, and `init` reports the offending line.

`init` uses conventional source roots: `src/` and `assets/` for TS/JS, `src/`, `lib/`, and `app/` for PHP, `src/` for Python, and `templates/` and `assets/` for web sources. If an auto-detected manifest has no source files in its default roots, `init` discovers eligible depth-1 source directories and records them in `paths.<language>`; excluded and conventional non-source directories are ignored. If no roots are discovered, that language is omitted and the CLI prints a `Notice: ...` line explaining how to add `paths.<language>`. Explicitly configured languages and paths still fail when they contain no source files.

Drupal projects that require `drupal/core` or `drupal/core-recommended` use their custom code automatically. For example, a standard `web/` docroot resolves PHP to `web/modules/custom`, `web/themes/custom`, and `web/profiles/custom`, while web and theme JavaScript checks use `web/themes/custom`. The equivalent `docroot/` paths are supported. Drupal core, contrib packages, public files, libraries, Drush, and DDEV provisioning code are excluded.

If the repository is PHP, install its application dependencies before checking. The normal CI setup is `composer install`, which creates the `vendor/` directory required by the PHP unused-code checks.

## Adopt in a new repo

Run the same `init` command from the new repository root after its first source and manifest files are present:

```sh
npx @runroom/code-quality init
```

Or, without Node:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 init
```

Review the detected languages and paths, then commit `.code-quality.yml`, `quality/`, and the generated caller workflow from the first commit. A new repository normally starts with empty or very small baselines and receives the same gate as it grows.

`init` does not invent architecture rules. Copy and review the starter templates in [quality-gate.md](docs/quality-gate.md) when architecture conventions are ready.

## Local use

The main local command is:

```sh
npx @runroom/code-quality check
```

Or, without Node:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check
```

The generated Makefile provides these commands:

| Make target | Command |
| --- | --- |
| `make quality` | `code-quality check` |
| `make quality-all` | `code-quality check --all` |
| `make quality-baseline` | `code-quality baseline` |
| `make quality-report` | `code-quality report` |
| `make quality-doctor` | `code-quality doctor` |

The CLI also provides:

- `check [checks...]` to run blocking checks;
- `baseline` to refresh existing baselines only when there is no regression;
- `report` for advisory health, duplication, and complexity reports;
- `versions` to print every pinned binary and library;
- `doctor` to verify installed versions and grammar assets.

Use `check --initialize` once for a new check or after reviewing a tool/configuration mismatch; it refuses to replace an existing snapshot. `init` creates missing baselines and keeps existing ones, reporting each kept file as `● Kept existing quality/<adapter-id>-baseline.json`.

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
| `report` | boolean | `false` | Run the advisory report after the check and upload `artifacts/quality` |
| `coverage-artifact` | string | empty | Artifact containing `coverage/coverage-final.json` for Fallow health |

```yaml
jobs:
  quality:
    needs: test
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
    with:
      checks: "complexity duplication unused"
      setup: composer install --no-interaction
      image-tag: v1
      working-directory: "."
      report: true
      coverage-artifact: test-coverage
```

The reusable job checks out the full history, runs the optional setup command, and invokes plain `code-quality check`. With `report` enabled, it also downloads the coverage artifact, runs `code-quality report`, and uploads `artifacts/quality` as the `quality-reports` artifact. Failing findings produce GitHub annotations, and the job summary is written to `GITHUB_STEP_SUMMARY`. It never passes `--update` or `--initialize`, so CI never writes baselines. Knip and the PHP unused checks need installed dependencies before they run: use `setup: pnpm install --frozen-lockfile` for pnpm, `setup: npm ci` for npm, or `setup: composer install` for Composer. The first two create `node_modules/` for Knip; Composer creates `vendor/` for the PHP unused checks.

## Check selection

With no arguments, `check` runs all detected and enabled checks. Pass logical IDs to select a subset, for example:

```sh
npx @runroom/code-quality check complexity duplication
```

Or, without Node:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check complexity duplication
```

The IDs are `complexity`, `cognitive`, `duplication`, `unused`, and `architecture`. A check can be disabled in `.code-quality.yml` only with a non-empty review reason. Architecture is skipped when no conventional or explicitly configured rules file exists.

## Baselines

Each concrete adapter owns `quality/<adapter-id>-baseline.json`. A snapshot records the schema version, exact tool stamp, configuration hash, and positive finding counts. Findings use stable structural anchors instead of line numbers; exact duplication uses the native jscpd fingerprint as its identity.

The CLI prints `Notice:` lines for non-fatal limitations, including source-root discovery and syntax-grammar fallbacks. A grammar fallback uses `~symbol` or `~L<line>` in the baseline key and should be reviewed because it is less stable than a structural anchor.

Initialize a check once with `check --initialize` after reviewing its current findings. Plain `check` fails when a finding is new or its value increased. A finding that disappears or decreases is marked stale and also fails until the baseline is refreshed. `baseline` is a local reduction-only update: it writes a tighter snapshot only when there is no regression. A tool-version or configuration-hash mismatch is an explicit regeneration event; review the change, remove the affected snapshot, and run `check --initialize`. CI refuses all baseline-writing modes.

## Output

`check` starts with the CLI version, detected languages, and check count. Each check then has a status row followed by its nested new, worsened, stale, or improved findings. Locations are `file:line:col`, `file:line`, or `file`; duplication locations use `a:start-end ↔ b:start-end`. `check --all` also prints unchanged current findings as `baselined`. A compact block at the end reports passed and failed checks, blocking findings, stale entries, skipped checks, and the final result. stderr keeps one line per failing adapter, such as `ts-complexity: 2 regressions` or `ts-complexity: 3 stale entries; run code-quality baseline and commit the reduced baseline`.

A realistic output block is:

```text
 code-quality 1.2.0 · ts, python · 5 checks

 ✔ ts-complexity      oxlint 1.82.0  280 findings
 ✖ ts-cognitive       fallow 3.23.0  18 findings · 2 new
   └ src/services/render.ts:18:1  max-params  Function has too many parameters  new
   └ src/orders/checkout.ts:42:5  complexity  Function is too complex  worsened 10 → 12
 ✖ python-complexity  ruff 0.16.6    24 findings · 1 new
   └ src/orders/checkout.py:42:5  C901  `checkout` is too complex (12 > 10)  new
 ✔ ts-duplication     jscpd 5.2.0    8 clones
 ✔ python-unused      vulture 2.16   3 findings
 – ts-architecture    skipped: no rules file

 Checks   3 passed · 2 failed
 Blocking 3 new findings
 Skipped  1
 Result   FAIL
```

`--color` and `--no-color` override everything; otherwise a non-empty `NO_COLOR` disables color, then `FORCE_COLOR` (any value but `0`) forces it, then color is on in GitHub Actions or when stdout is a TTY. The npm launcher forwards these settings.

`check`, `baseline`, and `init` accept `--artifacts <dir>` to retain raw tool output plus `stdout.log` and `stderr.log` per adapter. Without it, adapter output stays in a temporary directory and no adapter artifacts or logs are written by default. `report --output <dir>` selects the advisory report directory and defaults to `artifacts/quality/`.

`report --coverage <path>` gives Fallow an Istanbul `coverage-final.json` map, or a directory containing that file, so its advisory CRAP values use measured coverage. The repository-relative `report.coverage` configuration key does the same and requires code-quality 1.2.0 or newer; an explicit flag wins. Coverage paths that match no repository file produce a notice and CRAP stays estimated; missing or malformed coverage files still fail. The coverage file's directory is excluded from Fallow scans unless it overlaps a configured source path, in which case only the coverage file is excluded.

In GitHub Actions, each regression also emits a `::error file=…` annotation. The current Markdown summary is appended to `GITHUB_STEP_SUMMARY` when that environment variable is available.

## Configuration reference

`.code-quality.yml` accepts only these fields. Unknown fields and threshold-like settings are errors; thresholds are not configurable.

| Field | Type | Default and constraints |
| --- | --- | --- |
| `languages` | list of `ts`, `php`, `python`, `web` | Languages detected from manifests or web files; an explicit list selects a subset |
| `paths.ts` | list of repository-relative directory/file globs | Existing `src/` and `assets/` when TS/JS is detected |
| `paths.php` | list of repository-relative directory/file globs | Existing `src/`, plus existing `lib/` and `app/` when PHP is detected |
| `paths.python` | list of repository-relative directory/file globs | Existing `src/` when Python is detected |
| `paths.web` | list of repository-relative directory/file globs | Existing `templates/` and `assets/` containing `.twig`, `.html`, `.css`, `.scss`, or `.less` files |
| `exclude` | list of repository-relative glob patterns | No consumer exclusions; built-in test exclusions apply to every blocking check |
| `checks.disabled` | list of `{ id, reason }` objects | No checks disabled; `reason` must be non-empty prose |
| `architecture.ts.rulesFile` | repository-relative file path | `.dependency-cruiser.cjs` when it exists; otherwise skipped |
| `architecture.php.rulesFile` | repository-relative file path | `deptrac.yaml` when it exists; otherwise skipped |
| `architecture.python.rulesFile` | repository-relative file path | `.importlinter` when it exists; otherwise skipped |
| `report.coverage` | repository-relative Istanbul map or directory | Unset; requires code-quality 1.2.0 or newer |

An explicitly configured architecture file that is missing is an error. Consumer exclusions apply to applicable checks, while tests remain excluded from duplication regardless of the consumer paths.

A typical Symfony repository with frontend assets can use:

```yaml
languages: [php, ts, web]
paths:
  php: [src]
  ts: [assets]
  web: [templates, assets]
exclude:
  - "src/Migrations/**"
```

The migration exclusion is optional and is useful when generated Doctrine migrations should not participate in the gate.

A Drupal repository normally needs no path override:

```yaml
# composer.json requires drupal/core-recommended
exclude:
  - "web/modules/custom/site/generated/**"
```

The Drupal profile discovers custom modules, themes, and profiles and prints a `Notice:` describing the applied defaults. Normal applicable complexity, cognitive-complexity, duplication, and architecture checks run for the detected custom-code languages; PHP `composer-unused` and `composer-require-checker` run with installed Composer dependencies, while PHPStan dead-code analysis is skipped because consumer PHPStan extensions are incompatible with the image.

### Coverage for CRAP

When tests and the report run in the same job, configure Vitest's `json` coverage reporter (with either the V8 or Istanbul provider), then run:

```sh
vitest run --coverage
npx @runroom/code-quality report --coverage coverage/coverage-final.json
```

With the reusable workflow, have the tests job upload the `coverage/` directory as an artifact named `test-coverage`. The quality job must declare `needs: test`, then set `report: true` and `coverage-artifact: test-coverage` as shown above. Raw V8 output is not supported; the input must be the Istanbul map written by the Vitest or Jest JSON reporter.

## Version pinning

Pin npm consumers to the major launcher version with `npx @runroom/code-quality@1`. Pin Docker consumers to the major image tag `ghcr.io/runroom/code-quality:v1` and the reusable workflow reference `Runroom/code-quality/.github/workflows/quality.yml@v1`. The image carries the exact v1 tool matrix documented in [quality-gate.md](docs/quality-gate.md#v1-tool-pins); the workflow accepts only an `image-tag`, while the registry and repository remain fixed.

## Security notes

Consumer code executed by dependency-cruiser configuration, import-linter imports, or a setup command such as `composer install` runs inside the job container. Tool processes receive an environment allow-list plus tool-specific values rather than the complete parent environment. Consumer paths reject option-like values, colons, absolute paths, and parent-directory traversal. The reusable workflow fixes the image registry and repository to `ghcr.io/runroom/code-quality` and accepts only the tag.

The npm launcher runs the image through the local Docker client. `CODE_QUALITY_IMAGE` replaces the whole image reference and is validated only for shape, so set it only to images you trust: the repository is bind-mounted read-write. The Docker client inherits `DOCKER_HOST` and `DOCKER_CONTEXT` from the shell.

Accepted v1 supply-chain limitations are that global npm packages' transitive dependencies and Python packages are pinned only at the top level, and that the launcher resolves the image by tag rather than digest. Composer dependencies are fully locked, and downloaded phars are pinned and checksum-verified.

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

`pnpm verify` runs typecheck, lint, tests, and the bundle build. `pnpm integration` expects a locally built image and exercises the three fixture repositories plus deliberate mutations; on the first run, it installs fixture dependencies through the image. Native fixture capture is performed against a pinned image tool and is used by adapter parser tests.

A release tag also stages the npm launcher from `launcher/` through npm trusted publishing (OIDC) with `npm stage publish`; the trusted publisher has stage-only permission, so a maintainer must review and approve the staged version with 2FA (`npm stage list @runroom/code-quality`, then `npm stage approve <stage-id>`, or from the package page on npmjs.com) before it is installable. Staging requires npm 11.15 or later, which the release job installs explicitly. The very first version of the package cannot be staged and must be published by hand from `launcher/` (`pnpm build`, then `npm publish --access public`); the trusted publisher for repository `Runroom/code-quality` and workflow `release.yml` is configured on npmjs.com afterwards. A version bump must update root `package.json`, `launcher/package.json`, and the CLI version literal in `src/cli/version.ts` together.
