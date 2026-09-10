# Goal (locked 2026-09-09) — Runroom/code-quality

Create `github.com/Runroom/code-quality`: single project implementing the incremental quality gate from
bayer-int/wsf-nxg-figma-plugin#148 and bayer-int/wsf-nxg-figma-to-drupal#373 (complexity, duplication,
dead code, architecture, immutable reduction-only baseline) for TS/JS, PHP and Python. Distributed as
Docker image `ghcr.io/runroom/code-quality` + reusable GitHub workflow. Runnable locally and in Actions
from any consumer repo without copying scripts. The repo itself passes its own gate.

Out of scope: consumer lint/format/types/tests, coverage, replacing npm-scripts. Bayer repos untouched.
No push, no commit without explicit order.

## Acceptance criteria
1. Local repo ~/Projects/code-quality + private remote Runroom/code-quality created, no push. Verify: `git remote -v`, `gh repo view`.
2. Docker image builds with pinned tools. TS/JS: oxlint 1.82.0, fallow 3.23.0, jscpd 5.2.0, knip 6.35.1, dependency-cruiser 18.2.0 (v1 matrix supersedes the PR pins; all pins exact). PHP: phpmd, phpcs+slevomat, phpstan, deptrac, composer-unused, composer-require-checker. Python: ruff, complexipy, vulture, deptry, import-linter. Verify: `docker build` OK; `code-quality versions` prints all exact versions.
3. CLI `code-quality` (TS, Node 24): `check [tool]`, `baseline`, `report`, `init`, `versions`. Exit != 0 when a measurement exceeds baseline. Verify: unit tests + smoke on fixtures.
4. Language auto-detect by manifest (package.json, composer.json, pyproject.toml), override in `.code-quality.yml`. Verify: fixture tests.
5. Normalized baseline `quality/<check>-baseline.json` (file + rule + stable anchor + value). `--update` reduces only, fails on increase. Gated by config hash + tool version. CI never updates. Verify: tests ported from PRs with native-output fixtures per tool.
6. Reusable workflow `workflow_call` with inputs (`image`, `checks`, `setup`, `working-directory`), runs image, uploads artifacts, job summary. Verify: `actionlint` + schema tests. Real E2E pending until push (flagged).
7. Local: `code-quality init` generates Makefile target / docker run wrapper + caller workflow in consumer. Verify: run in 3 fixture repos (TS, PHP, Python) under `fixtures/`: each produces baseline and `check` passes.
8. TS thresholds identical to PRs (complexity 10, lines 60, params 4, depth 3, callbacks 3, cognitive 15, jscpd 50/5). PHP and Python equivalents documented in `docs/quality-gate.md`.
9. Dogfooding: `code-quality check` on own repo passes with empty baselines (0 findings). Own workflow runs gate with image built in-job. Verify: local run + `actionlint`.
10. `release` workflow publishes image to ghcr on tag `v*`. Verify: `actionlint`; real publish pending until push.
11. README: adopt in existing/new repo, local use, CI, baseline refresh, versioning policy.
