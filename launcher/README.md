# @runroom/code-quality

Thin npm launcher for the Dockerized incremental quality gate for TypeScript/JavaScript, PHP, Python, and web templates.

## Requirements

Docker must be running; Node 18 or newer is required for `npx`.

## Getting started

1. Initialize from the repository root; this writes `.code-quality.yml`, `quality/` baselines, the caller workflow, Makefile targets, and the report-directory `.gitignore` entry:
   ```sh
   npx @runroom/code-quality init
   ```
2. Review and stage the configuration with its baselines; existing findings are recorded once, while new or worsened findings and stale entries from improved or removed findings fail until `make quality-baseline` or `check --update` refreshes the baseline:
   ```sh
   git add .code-quality.yml quality/
   ```
3. Run the gate:
   ```sh
   make quality  # or: npx @runroom/code-quality check
   ```

## Commands

| Command | What it does |
| --- | --- |
| `init` | Scaffolds configuration, CI, Make targets, and missing baselines. |
| `check [ids…]` | Runs all enabled checks or selected check IDs. |
| `check --all` | Also prints unchanged findings. |
| `check --update` / `baseline` | Refreshes baselines when nothing regresses. |
| `check --initialize` | Creates missing baselines without replacement. |
| `report [--output <dir>] [--coverage <path>]` | Generates advisory reports with optional Istanbul coverage. |
| `doctor` | Verifies tools and grammar assets. |
| `versions` | Prints pinned tool versions. |

## How it works

- Launcher X.Y.Z runs the tag `ghcr.io/runroom/code-quality:vX.Y.Z`; the equivalent is `docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:vX.Y.Z <args>`. `CODE_QUALITY_IMAGE` can override the full reference with a tag or digest, but shape validation does not establish trust and the image receives a read-write repository mount.
- The launcher forwards `CI`, `GITHUB_ACTIONS`, `NO_COLOR`, and `FORCE_COLOR`. When host stdout is a TTY and neither color variable is set, it injects `FORCE_COLOR=1` because Docker runs without `-t`.
- `--color` and `--no-color` come first, then non-empty `NO_COLOR`, then a defined `FORCE_COLOR`: `0` disables and every other value, including empty, enables. Only when `FORCE_COLOR` is unset can `GITHUB_ACTIONS=true` or a TTY enable color.
- `report --coverage` accepts a repository-relative Istanbul `coverage-final.json` file or its directory for measured advisory CRAP. `report.coverage` provides the same option from 1.2.0, and raw V8 data is unsupported.

See the [sample output](https://github.com/Runroom/code-quality#what-you-get), the [project README](https://github.com/Runroom/code-quality#readme), and the [documentation](https://github.com/Runroom/code-quality/tree/main/docs) for everything else.

## License

MIT
