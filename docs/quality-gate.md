# Quality gate reference

## Purpose and fixed policy

The quality gate makes incremental improvement enforceable in repositories that already have technical debt. The first reviewed baseline records the current state. Thereafter, the blocking gate rejects new findings, increased measurements, stale baseline entries, invalid reports, and tool or configuration mismatches.

The policy is owned by the image and is not a consumer setting. `.code-quality.yml` can select languages, paths, exclusions, disabled checks with reasons, and architecture rule files, but it cannot change thresholds, tools, parser strictness, or baseline comparison semantics.

## Built-in test exclusions

Every blocking check applies the built-in `TEST_EXCLUSIONS` patterns, so test files are excluded from complexity, cognitive complexity, exact duplication, unused-code, and architecture checks. The patterns are `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/tests/**`, `**/test/**`, `**/*Test.php`, `**/test_*.py`, `**/*_test.py`, and `**/conftest.py`. Generated frontend bundles under `public/build`, `*.min.js`, `*.min.css`, and Symfony `var/` cache files are also built-in exclusions. Drupal exclusions cover `web/core`, `docroot/core`, contrib modules/themes/profiles, libraries, public site files, Drush, and DDEV provisioning paths. Consumer `exclude` patterns are additive.

## Language detection

Without an explicit `languages` list, manifests detect TS/JS from `package.json`, PHP from `composer.json`, and Python from `pyproject.toml` or `setup.py`. Web needs no manifest: `.twig`, `.html`, `.css`, `.scss`, or `.less` files under `templates/` or `assets/` detect it. When an auto-detected manifest language has no source files in its default roots, depth-1 source directories are discovered (excluding hidden, test, build, dependency, and other generated roots) and written to `paths.<language>`. If no roots are discovered, the language is omitted and reported as a `Notice: ...` line; languages listed explicitly or given explicit paths still fail when no source files are found.

When `composer.json` requires `drupal/core` or a `drupal/core-*` package, the Drupal profile defaults PHP to existing custom module, theme, and profile directories below `web/` or `docroot/`. Web defaults to custom theme directories, and TS/JS adds those directories when they contain JavaScript. If no custom Drupal directory exists, ordinary source-root discovery remains the fallback. A `Notice:` explains when the Drupal profile is active. The normal applicable complexity, cognitive-complexity, duplication, and architecture checks run for the detected custom-code languages; PHP `composer-unused` and `composer-require-checker` also run when Composer dependencies are installed, while PHPStan dead-code analysis is skipped because consumer PHPStan extensions are incompatible with the image.

The source walker skips files whose longest line exceeds 1,000 characters, names ending in `.min.js` or `.min.css`, and versioned JavaScript bundles such as `swagger-ui-4.18.3.js`. Their exact repository-relative paths are added to every adapter's exclusions. One `Notice:` lists up to five skipped files and reports the remaining count.

## Thresholds by language

The v1 thresholds are fixed as follows.

| Check | Language | Tool(s) | Threshold and semantics |
| --- | --- | --- | --- |
| Complexity | TS/JS | oxlint 1.82.0 | Complexity 10; max lines per function 60, skipping blank lines and comments; max parameters 4; max depth 3; max nested callbacks 3. Only warning diagnostics are accepted. |
| Complexity | PHP | PHPCS 4.0.4 with Slevomat coding standard 8.31.1 and the Runroom standard | `Generic.Metrics.CyclomaticComplexity` complexity 10; `Generic.Metrics.NestingLevel` nesting level 3; `SlevomatCodingStandard.Functions.FunctionLength` maxLinesLength 60; `Runroom.Metrics.ParameterCount` maxParameters 4. |
| Complexity | Python | Ruff 0.16.6 | C901 max-complexity 10; PLR0915 max-statements 60; PLR0913 max-args 4; PLR1702 max-nested-blocks 3. |
| Cognitive complexity | TS/JS | Fallow 3.23.0 | Values greater than 15 block. |
| Cognitive complexity | PHP | Slevomat coding standard 8.31.1 through PHPCS | `SlevomatCodingStandard.Complexity.Cognitive` maxComplexity 15; values greater than 15 block. |
| Cognitive complexity | Python | complexipy 8.0.1 | SARIF `ruleId: CC001`; values greater than 15 block, with the measurement and source location read from SARIF. |
| Exact duplication | TS/JS, PHP, Python | jscpd 5.2.0 | Mild mode, minimum 50 tokens and 5 lines; tests are excluded from every blocking check. Native fingerprints are the baseline keys. |
| Exact duplication | Web | jscpd 5.2.0 | The only web check; scans Twig, HTML, CSS, SCSS, and Less in mild mode with a minimum of 50 tokens and 5 lines. Native fingerprints are the baseline keys. |
| Unused code | TS/JS | Knip 6.35.1 | Unused files, exports, types, dependencies, and devDependencies. |
| Unused code | PHP | composer-unused 0.9.6, composer-require-checker 4.24.0, PHPStan 2.2.13 with ShipMonk dead-code-detector 1.4.0 | Unused packages, invalid or unused Composer requirements, and dead code. |
| Unused code | Python | Vulture 2.16 and deptry 0.25.1 | Unused code and dependency problems. |
| Architecture | TS/JS | dependency-cruiser 18.2.0 | Runs only when `.dependency-cruiser.cjs` or a configured rules file exists. |
| Architecture | PHP | deptrac 4.7.1 | Runs only when `deptrac.yaml` or a configured rules file exists. |
| Architecture | Python | import-linter 2.15 | Runs only when `.importlinter` or a configured rules file exists. |

## v1 tool pins

These are the exact binary and library pins in the v1 image. `versions` prints the 15 binary pins and the two library pins, and `doctor` verifies them.

| Family | Binary or package | Pin |
| --- | --- | --- |
| TS/JS | oxlint | 1.82.0 |
| TS/JS | fallow | 3.23.0 |
| TS/JS | jscpd | 5.2.0 |
| TS/JS | knip | 6.35.1 |
| TS/JS | dependency-cruiser (`depcruise`) | 18.2.0 |
| PHP | squizlabs/php_codesniffer (`phpcs`) | 4.0.4 |
| PHP | slevomat/coding-standard | 8.31.1 |
| PHP | phpstan | 2.2.13 |
| PHP | shipmonk/dead-code-detector | 1.4.0 |
| PHP | deptrac | 4.7.1 |
| PHP | composer-unused | 0.9.6 |
| PHP | composer-require-checker | 4.24.0 |
| Python | ruff | 0.16.6 |
| Python | complexipy | 8.0.1 |
| Python | vulture | 2.16 |
| Python | deptry | 0.25.1 |
| Python | import-linter (`lint-imports`) | 2.15 |

The two Composer library pins are resolved and checked from the installed package metadata inside the image. They are part of the version contract even though they are not standalone binary probes.

## Baseline semantics

Each adapter writes `quality/<adapter-id>-baseline.json` with schema version 1, its exact `tool@version` stamp, a SHA-256 configuration hash, and a sorted map of positive finding counts.

- A new key or an increased value is a regression and fails `check`.
- An equal value passes.
- A missing key or decreased value is stale and also fails until the baseline is tightened.
- A reduction-only `baseline` update may write a current snapshot only when there is no regression.
- `check --initialize` writes a missing snapshot, including an empty findings map, but never replaces an existing snapshot.
- Tool-version and config-hash mismatches require a reviewed regeneration: remove the affected snapshot and initialize it again.
- The reusable workflow runs plain `check` and never writes baselines; `GITHUB_ACTIONS=true` also protects the CLI from update, initialize, baseline, and init writes.
- The reusable workflow accepts only lowercase, space-separated check IDs and fixes its image registry and repository to `ghcr.io/runroom/code-quality`; only `image-tag` is caller-controlled.
- Tool subprocesses inherit only approved environment variables plus constant and invocation-specific tool settings.

The comparison is per key. A reduction in one finding cannot fund an increase in another finding. Native parser errors, unknown records, incomplete reports, invalid paths, and duplicate normalized keys fail closed.

## Exact duplication

The duplication gate uses jscpd 5.2.0 in mild mode with `minTokens: 50` and `minLines: 5`. Web duplication enables the `twig`, `html`, `css`, `scss`, and `less` jscpd formats. Tests are excluded from every blocking check through the built-in test exclusion list regardless of consumer paths; consumer `exclude` patterns apply as well. Pass `--artifacts <dir>` when the native jscpd baseline and report need to be retained for inspection; the committed quality snapshot remains owned by the code-quality comparator. Small repositories whose source files are all below that detection window yield an empty baseline; a repository with no candidate source files fails clearly before jscpd runs.

For ordinary checks, keys are normalized as `<file> | <rule> | <anchor>`. Duplication is the explicit exception: each native jscpd fingerprint is the key and its native occurrence count is the value. With `--artifacts <dir>`, the native JSON report and baseline are retained under `<dir>/<adapter-id>/` for review.

## Unused-code checks

Unused checks are split into concrete adapters so each tool has its own version stamp and baseline:

- TypeScript/JavaScript uses Knip for files, exports, types, dependencies, and devDependencies.
- PHP uses composer-unused for packages, composer-require-checker for Composer requirements, and PHPStan with ShipMonk’s dead-code detector for dead code.
- Python uses Vulture for unused symbols and deptry for dependency diagnostics.

Knip requires an installed `node_modules/` directory when the repository has a `package.json`. Run the repository’s package-manager install before `code-quality check`; in reusable CI, use the `setup` input, for example `setup: pnpm install --frozen-lockfile` or `setup: npm ci`. The gate reports this prerequisite directly when it is missing. Knip runs with configuration-executing plugins disabled; dependencies referenced only from tool configuration files appear as unused and are simply baselined. Its entry heuristics cover conventional `index`, `main`, and `cli` files, and files under `bin` directories in each configured source root. Repository-level `tests`, `test`, `__tests__`, and `*.test`/`*.spec` patterns are explicit entries and project files regardless of configured source paths, so test-only export usage is resolved. Scripts referenced by `package.json` scripts are also treated as entries, such as `node scripts/build.ts`.

PHP unused checks require a usable `vendor/` directory because the Composer application dependencies and PHPStan analysis context must be installed. Run `composer install` before `code-quality check`; in reusable CI, use the `setup` input, for example `setup: composer install`. The gate reports this prerequisite directly when it is missing.

PHPStan dead-code findings use the key shape `<file> | dead-code | <anchor>#<identifier>#<member>`, where `<member>` is extracted from the diagnostic’s fully qualified `FQN::member` token (for example, `$locales`, `run`, or `CONSTANT`).

The setup command and tools that load consumer code run within the job container. Local containers use the image's `node` user; GitHub container jobs use root because GitHub Actions owns the mounted workspace as root.

## Architecture conventions

Architecture is consumer-owned. The gate does not invent rules: it uses `.dependency-cruiser.cjs` for TypeScript/JavaScript, `deptrac.yaml` for PHP, and `.importlinter` for Python, or the corresponding explicitly configured `rulesFile`. No file means a deliberate skip; an explicitly named missing file is an error.

The starter conventions below are deliberately small and must be reviewed before enabling them.

### dependency-cruiser

```js
// .dependency-cruiser.cjs
module.exports = { forbidden: [
  { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  { name: "no-ui-to-db", severity: "error", from: { path: "^src/ui" }, to: { path: "^src/db" } },
], options: { tsPreCompilationDeps: true, tsConfig: { fileName: "tsconfig.json" }, doNotFollow: { path: "node_modules" } } };
```

### deptrac

```yaml
# deptrac.yaml
deptrac:
  paths: [src]
  layers:
    - { name: Domain, collectors: [{ type: directory, value: src/Domain/.* }] }
    - { name: Infrastructure, collectors: [{ type: directory, value: src/Infrastructure/.* }] }
  ruleset:
    Domain: []
    Infrastructure: [Domain]
```

### import-linter

```ini
# .importlinter
[importlinter]
root_package = my_app
[importlinter:contract:layers]
name = Layers
type = layers
layers =
    my_app.infra
    my_app.domain
```

Import-linter output is parsed strictly. Consumer contracts must not set `broken_contract_guidance`: the additional guidance text is not part of the supported normalized result format and causes the parser to reject the report. Keep contracts to the supported result output and use `--artifacts <dir>` to retain raw logs when investigating a broken contract.

When import-linter reports a module that cannot be resolved to a source file, its stable key is `<module id> | import-linter:<contract>:unresolved | <upper>`.

## Structural anchors

Locations from native tools are converted to structural paths so line shifts, comments, and blank lines do not churn a baseline. A named class method can look like `/class:Foo/method:bar`; a function and a nested block diagnostic can look like `/function:busy/if[11]/block/if`. Anchors contain no line, column, or byte offset.

Names come from the syntax tree. An ordinal is added only when anonymous or same-labeled siblings collide. Renames, moving a declaration to another structural parent, grammar-visible edits, and reordering anonymous siblings can legitimately change an anchor and require reviewed initialization. An invalid location or ambiguous normalized key fails instead of being dropped.

Some supported tree-sitter grammars reject otherwise valid newer syntax. When the diagnostic's structural path cannot be parsed safely, its anchor falls back to `~symbol` when the tool reports a symbol name, or `~L<line>` otherwise. The CLI prints one `Notice:` per affected file because these fallback keys are less stable than structural paths.

## Blocking and advisory reports

`check` is the blocking command. It compares every concrete adapter’s findings with its committed snapshot and returns a non-zero exit code for regressions, stale entries, mismatches, or parser/tool failures.

`report` is advisory: it retains full Fallow health and semantic-duplication output, complexipy JSON, and jscpd HTML for investigation. Advisory similarity and health reports do not alter the exact jscpd or complexity baselines and do not turn a report-only measurement into an accepted regression.

Coverage-backed CRAP remains advisory only and never changes the blocking quality gate.

### Output

`check` prints one line per failing finding as `file:line:col  rule  message  [new]`, `[worsened P → V]`, or `[stale: was P]`; duplication uses `a:start-end ↔ b:start-end`. `check --all` also prints every current finding with `[baselined]`.

Fallow production discovery may scan the whole repository; blocking findings outside the configured source paths are explicitly skipped.

## Tool-version bump procedure

A tool version bump is a policy change and follows these five steps:

1. Change the pinned version in `src/registry.ts` and the image build definition.
2. Capture new native-output fixtures from that exact image tool.
3. Run unit and integration tests plus `doctor`.
4. Build and release the new image tags.
5. Have consumers explicitly regenerate affected snapshots after reviewing the changes; ordinary `--update` is not a tool-version migration mechanism.

The v1 workflow and image are consumed through `@v1` and `v1`. A breaking CLI, snapshot, parser, or policy contract starts a new major line.
