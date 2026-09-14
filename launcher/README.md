# @runroom/code-quality

This package is a thin launcher for an incremental quality gate for TypeScript/JavaScript, PHP, Python, and web templates. It runs the pinned Docker image `ghcr.io/runroom/code-quality`, and its findings use reduction-only baselines.

## Requirements

- Docker must be running.
- Node 18 or newer is required for `npx`.

## Usage

```sh
npx @runroom/code-quality init                          # scaffold configuration and baselines
npx @runroom/code-quality check                         # run all configured checks
npx @runroom/code-quality check complexity duplication  # run selected checks
npx @runroom/code-quality report                        # generate advisory reports
npx @runroom/code-quality report --coverage coverage/coverage-final.json  # advisory reports with measured CRAP
npx @runroom/code-quality doctor                        # verify tools and grammar assets
npx @runroom/code-quality versions                      # list pinned tool versions
```

## How it works

Launcher X.Y.Z always runs image `ghcr.io/runroom/code-quality:vX.Y.Z`. The equivalent direct command is:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:vX.Y.Z <args>
```

`CODE_QUALITY_IMAGE` overrides the image and is validated as an image reference. Set it only to an image you trust because the current directory is mounted read-write into the container.

`report --coverage <path>` (or the `report.coverage` key in `.code-quality.yml`, available from 1.2.0) gives Fallow an Istanbul `coverage-final.json` map, or a directory containing it, so the advisory CRAP values use measured coverage instead of the 0 % estimate. Vitest's `json` coverage reporter writes that format with either the V8 or Istanbul provider; raw V8 output is not supported. The path must be repository-relative and the blocking checks are not affected.

`CI`, `GITHUB_ACTIONS`, `NO_COLOR`, and `FORCE_COLOR` are forwarded to the container. `--color` and `--no-color` override everything; otherwise a non-empty `NO_COLOR` disables color, then `FORCE_COLOR` (any value but `0`) forces it, then color is on in GitHub Actions or when stdout is a TTY.

## Documentation

See the [repository documentation](https://github.com/Runroom/code-quality#readme) for `.code-quality.yml` configuration, checks, baselines, and the reusable GitHub Actions workflow.

## License

MIT
