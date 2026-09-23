# CI

## Reusable GitHub Actions workflow

Add this caller to the consumer repository:

```yaml
name: quality
on: [pull_request, push]
permissions: { contents: read, packages: read }
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
```

The workflow fixes the registry and repository to `ghcr.io/runroom/code-quality`. The caller controls only these inputs:

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `image-tag` | string | `v1` | Tag pulled from the fixed image repository. |
| `checks` | string | empty | Lowercase, space-separated logical check IDs; empty runs every detected check. |
| `setup` | string | empty | Consumer shell command run before checking. |
| `working-directory` | string | `.` | Consumer directory inside `/work`. |
| `report` | boolean | `false` | Run the advisory report and upload `artifacts/quality`. |
| `coverage-artifact` | string | empty | Artifact containing `coverage/coverage-final.json` for Fallow health. |

The job:

1. Checks out the full Git history with `fetch-depth: 0`.
2. Runs the optional setup command in `working-directory`.
3. Validates the shape of the checks input (lowercase letters and spaces) and, when used, the coverage artifact name. Unknown IDs are rejected by the CLI.
4. Runs plain `code-quality check` with the selected IDs.
5. When `report` is true, optionally downloads coverage, runs `code-quality report`, and uploads `artifacts/quality` as `quality-reports` for 14 days.

The workflow accepts lowercase check IDs separated by spaces. Coverage artifact names accept letters, digits, `.`, `_`, and `-`.

## Dependency setup

Knip needs installed `node_modules/`; the PHP unused-code adapters need `vendor/`. Use the consumer repository's package manager:

```yaml
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
    with:
      setup: pnpm install --frozen-lockfile
```

For npm, use `setup: npm ci`. For Composer, use `setup: composer install` or a suitable non-interactive variant such as `setup: composer install --no-interaction`.

Setup is one shell command and may chain installers, for example `setup: composer install --no-interaction && npm ci`. Drupal and Symfony repositories with a frontend need both dependency trees because ts-unused requires `node_modules/`. The image includes `patch`, so Composer patch plugins used by Drupal can apply project patches.

The image supports these dependency setup recipes:

- `setup: pnpm install --frozen-lockfile` — Corepack honors the repository's `packageManager`; pnpm 10.17.1 and 11.5.2 are pre-cached, and other pins download on demand.
- `setup: yarn install --frozen-lockfile` — yarn 1.22.22 is pre-cached.
- `setup: uv sync --frozen` — uv uses the image's CPython 3.14.7 or 3.13; `.python-version` drives the choice.
- `setup: composer install --ignore-platform-req=php` — use this for repositories pinned to `php: ~8.3.0`, because the image runs PHP 8.4.

When possible, widen PHP dependency templates to `^8.3` so both PHP 8.3 and 8.4 satisfy the declared platform requirement.

A complete customized caller can select checks, install PHP dependencies, pin the image major, select a consumer subdirectory, and retain reports:

```yaml
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
    with:
      checks: "complexity duplication unused"
      setup: composer install --no-interaction
      image-tag: v1
      working-directory: "."
      report: true
```

## Coverage from a test job

When tests and reports run in one job, generate `coverage/coverage-final.json` with the Vitest or Jest JSON reporter and call `code-quality report --coverage coverage/coverage-final.json`.

When tests run in a separate job, upload the `coverage/` directory as an artifact, conventionally named `test-coverage`. Make the quality job depend on the test job, enable reports, and identify the artifact:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: npm ci
      - run: npm test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: test-coverage
          path: coverage/
  quality:
    needs: test
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
    with:
      report: true
      coverage-artifact: test-coverage
```

The reusable workflow downloads the artifact to `coverage/` and passes `coverage/coverage-final.json` to the report. Raw V8 output is not supported; enable the JSON reporter even when Vitest uses the V8 provider.

## Results and baselines

Each regression produces a GitHub error annotation. When `GITHUB_STEP_SUMMARY` is available, code-quality appends its Markdown summary to the job summary.

The reusable workflow never passes `--update` or `--initialize`; it runs plain `check`, so it never writes baselines. The CLI also refuses `init`, `baseline`, `--update`, and `--initialize` when `GITHUB_ACTIONS=true` or `CI` is `true`, `1`, or `yes`.

Baseline changes require local review and a separate commit. This prevents a CI job from accepting the regressions it is meant to detect.

## Generated Make targets

See [Makefile behavior](configuration.md#makefile-behavior) for the generated local targets and Docker recipe.

## Container users

See [Container users](security.md#container-users) for the authoritative behavior of the image, launcher, and GitHub container job.

## Self-hosted pipelines

A pipeline outside GitHub Actions can run the launcher after installing Node 18 or newer and providing Docker:

```sh
npx @runroom/code-quality@1 check
```

The launcher runs image vX.Y.Z for launcher X.Y.Z and forwards `CI`, `GITHUB_ACTIONS`, `NO_COLOR`, and `FORCE_COLOR`. When host stdout is a TTY and neither color variable is set, it injects `FORCE_COLOR=1` because `docker run` does not allocate a container TTY. It does not mount a host `GITHUB_STEP_SUMMARY` file into the container, so use the reusable workflow when GitHub job-summary integration is required.

Without Node, run the image directly:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check
```

Install application dependencies before the check when unused-code adapters require them. Treat setup commands and image overrides as trusted code; see [Security](security.md).
