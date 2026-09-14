# code-quality

Incremental quality gate for TypeScript/JavaScript, PHP, Python, and web templates, with a fixed policy and reduction-only baselines.

[![npm version](https://img.shields.io/npm/v/%40runroom%2Fcode-quality)](https://www.npmjs.com/package/@runroom/code-quality) [![CI](https://github.com/Runroom/code-quality/actions/workflows/ci.yml/badge.svg)](https://github.com/Runroom/code-quality/actions/workflows/ci.yml)

## Why

- Policy lives in the image: thresholds and tool versions are fixed, while consumers choose languages, paths, exclusions, disabled checks with a reason, and architecture rules.
- Reduction-only baselines let existing codebases adopt the gate without fixing history; new or worsened findings and stale entries from improved or removed findings block until the baseline is refreshed.
- One command covers TS/JS, PHP, Python, and web templates with pinned tools including Oxlint, Fallow, jscpd, Knip, PHPCS, PHPStan, Ruff, Vulture, and the architecture linters.
- The same image runs locally and in CI, producing identical results.
- Advisory health, duplication, complexity, and optional measured-coverage CRAP reports stay separate from the blocking gate.

## Getting started

Requirements: Docker must be running; Node 18 or newer is required for `npx`.

1. Initialize from the repository root:

   ```sh
   npx @runroom/code-quality init
   ```

   This writes `.code-quality.yml`, `quality/` baselines, `.github/workflows/quality.yml`, Makefile targets, and an `artifacts/quality/` `.gitignore` entry.

2. Review `.code-quality.yml`, then commit it together with `quality/`.

   ```sh
   git add .code-quality.yml quality/
   ```

   Existing findings are recorded once; new or worsened findings fail, and improved or removed findings also fail as stale until `make quality-baseline` or `check --update` refreshes the baseline.

3. Run the gate:

   ```sh
   make quality
   # or
   npx @runroom/code-quality check
   ```

Without Node, the equivalent is `docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 <command>`.

## What you get

A check shows the policy version, adapters, findings, and final result:

```text
 code-quality 1.2.0 · ts, python · 6 checks

 ✖ ts-complexity          oxlint 1.82.0  280 findings · 2 new
   └ src/services/render.ts:18:1  eslint(complexity)  function `render` has a complexity of 12. Maximum allowed is 10.  new
   └ src/orders/checkout.ts:42:5  eslint(max-params)  Function 'checkout' has too many parameters (6). Maximum allowed is 4.  worsened 4 → 6
 ✖ ts-cognitive           fallow 3.23.0  18 findings · 1 new
   └ src/services/render.ts:18:1  cognitive-complexity  Function 'render' has a cognitive complexity of 18. Maximum allowed is 15.  new
 ✖ python-complexity      ruff 0.16.6    24 findings · 1 new
   └ src/orders/checkout.py:42:5  C901  `checkout` is too complex (12 > 10)  new
 ✔ ts-duplication         jscpd 5.2.0    8 clones
 ✔ python-unused-vulture  vulture 2.16   3 findings
 ✔ python-unused-deptry   deptry 0.25.1  0 findings
 – ts-architecture        skipped: no .dependency-cruiser.cjs

 Checks   3 passed · 3 failed
 Blocking 4 new findings
 Skipped  1
 Result   FAIL
```

Findings nest under each adapter and use `new`, `new?`, `worsened`, `stale`, `improved`, and `baselined` tags; GitHub Actions also receives annotations. `--color` and `--no-color` come first, then non-empty `NO_COLOR`; a defined `FORCE_COLOR` decides next (`0` disables, every other value, including empty, enables), and only when it is unset can `GITHUB_ACTIONS=true` or a TTY enable color. See [Output](docs/checks.md#output).

## Commands

| Command | What it does |
| --- | --- |
| `init` | Scaffolds configuration, CI, Make targets, and missing baselines. |
| `check [ids…]` | Runs all enabled checks or the selected logical check IDs. |
| `check --all` | Also prints unchanged current findings as `baselined`. |
| `check --update` / `baseline` | Refreshes existing baselines only when no finding regresses. |
| `check --initialize` | Creates missing baselines without replacing existing ones. |
| `report [--output <dir>] [--coverage <path>]` | Generates advisory reports, optionally using Istanbul coverage. |
| `doctor` | Verifies installed tool versions and grammar assets. |
| `versions` | Prints every pinned binary and library version. |

Global `--color` and `--no-color` flags override automatic color selection.

Check IDs are `complexity`, `cognitive`, `duplication`, `unused`, and `architecture`; `--update`, `--initialize`, `init`, and `baseline` refuse writes when `GITHUB_ACTIONS=true` or `CI` is `true`, `1`, or `yes`.

## CI

Call the reusable workflow from the consumer repository:

```yaml
name: quality
on: [pull_request, push]
permissions: { contents: read, packages: read }
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
```

Inputs are `image-tag`, `checks`, `setup`, `working-directory`, `report`, and `coverage-artifact`; see [CI](docs/ci.md).

Knip and the PHP unused checks need dependencies installed, so use [`setup:`](docs/ci.md#dependency-setup).

## Configuration

```yaml
languages: [ts, web]
paths:
  ts: [src]
  web: [templates]
checks:
  disabled:
    - id: architecture
      reason: "Architecture rules are not defined yet"
```

See [Configuration](docs/configuration.md) for detection, defaults, validation, framework profiles (Drupal, Payload/Next), and every key.

## Documentation

- [Configuration](docs/configuration.md) — Schema, detection, paths, and scaffolding
- [Checks and policy](docs/checks.md) — Thresholds, baselines, output, and reports
- [CI](docs/ci.md) — Reusable workflow inputs and examples
- [Security](docs/security.md) — Trust boundaries and supply-chain limits
- [Development](docs/development.md) — Verification, releases, and tool bumps

## Versioning

Pin the launcher as `npx @runroom/code-quality@1`, the image as `ghcr.io/runroom/code-quality:v1`, and the workflow as `Runroom/code-quality/.github/workflows/quality.yml@v1`; launcher X.Y.Z runs image vX.Y.Z. A breaking CLI, snapshot, parser, policy, or workflow contract starts a new major line.
