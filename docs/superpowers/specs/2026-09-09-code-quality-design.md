# Runroom/code-quality design specification

## 1. Summary and goals

`github.com/Runroom/code-quality` is one maintained Runroom project that packages the incremental quality gate proven in the Bayer pull requests `wsf-nxg-figma-plugin#148` and `wsf-nxg-figma-to-drupal#373`. It runs against a consumer repository containing TypeScript/JavaScript, PHP, or Python and is usable both from a local Docker command and from a reusable GitHub Actions workflow. Consumer repositories receive the executable and policy through the Docker image and workflow; they do not copy the Bayer scripts.

The current Runroom package landscape does not provide this shared implementation: `eslint-config-runroom` and `stylelint-config-runroom` are archived, and `npm-scripts` is frontend-only. The two Bayer pull requests independently copied their quality scripts, hardcoded repository paths in configuration, and used different jscpd versions (5.1.1 and 5.2.0); both implementations were TypeScript-only. This project removes that maintenance split while preserving the proven incremental comparison behavior.

The v1 product has these goals:

- Detect complexity, cognitive complexity, exact duplication, unused code, and optional architecture violations.
- Compare current measurements with an immutable, reduction-only snapshot so existing debt is tolerated while new or worsened debt blocks the check.
- Normalize findings to stable file/rule/structural-anchor keys and positive integer values, while retaining native jscpd fingerprints for duplicate findings.
- Support the three languages through one TypeScript CLI, one central check registry, generated temporary tool configuration, and pinned tool binaries in a Node 24 Docker image.
- Make policy thresholds owned by Runroom. Consumer configuration may select languages and source paths, exclude paths, supply architecture rules, and disable a check only with a written reason; it cannot change thresholds.
- Produce machine-readable comparisons, Markdown summaries, native reports, and a GitHub step summary when GitHub provides `GITHUB_STEP_SUMMARY`.
- Make its own repository pass the gate with zero current findings and provide fixtures that exercise successful and failing scans.

The design uses “must” for an invariant required for a passing implementation and “may” only for an explicitly advisory or optional behavior. The v1 policy is the approved design in this document. A consumer cannot replace the image’s pinned tools or policy thresholds.

## 2. Non-goals

The gate does not replace a consumer’s linting, formatting, type checking, or test commands. It does not enforce coverage thresholds, collect coverage, or replace `npm-scripts`. Existing Runroom packages `eslint-config-runroom` and `stylelint-config-runroom` remain archived, and the frontend-only `npm-scripts` package is not generalized.

The project does not modify either Bayer repository, copy their scripts as a distribution mechanism, or allow consumers to edit Runroom’s thresholds. It does not provide a general-purpose code formatter, compiler, test runner, dependency installer, or package manager. A PHP consumer is responsible for making `vendor/` available before checks that require installed Composer packages; the reusable workflow provides a setup hook for that purpose.

Consumers do not update baselines from CI. A baseline update is a deliberate repository change performed locally, reviewed, and committed by the consumer. Architecture checks are optional because they run only when the relevant consumer rules file exists; their rules are consumer-owned, but their adapter and failure semantics are Runroom-owned.

## 3. Architecture overview

### Repository layers

The implementation is a strict TypeScript project targeting Node 24. Its source layers are:

```text
src/
  cli/                         command parsing and command handlers
  core/                        config, detection, snapshots, comparison, anchors,
                               process execution, hashes, reporting, summaries
  checks/
    ts/<check>.ts              TypeScript/JavaScript adapters
    php/<check>.ts             PHP adapters
    python/<check>.ts          Python adapters
  registry.ts                  central list and lookup of all adapters
```

The build produces one esbuild bundle at `dist/cli.js`. The runtime image exposes that bundle as the `code-quality` binary. There is no per-consumer TypeScript source distribution.

Every adapter implements one interface. The following is illustrative type shape, not a second public API:

```ts
interface CheckAdapter {
  id: string;
  language: "ts" | "php" | "python";
  tool: { bin: string; version: string };
  configFiles(ctx: CheckContext): string[];
  run(ctx: CheckContext): Findings;
}
```

`Findings` is a normalized mapping from a finding key to a positive integer. The adapter owns native-output validation and key/value derivation. The core owns process execution, output capture, tool verification, snapshot comparison, and reporting. The registry is the only source used to discover supported checks, resolve requested IDs, generate configurations, and report versions. A logical check ID such as `complexity` may expand to several concrete tool-backed adapters when the policy requires more than one tool; each concrete adapter still has exactly one `tool: { bin, version }` stamp and one snapshot. The CLI reports the logical check as passing only when every expanded adapter passes.

### Components

| Component | Responsibility | Required behavior |
| --- | --- | --- |
| CLI command layer | Parse `check`, `baseline`, `report`, `init`, `versions`, and `doctor` | Reject unknown commands, IDs, and incompatible flags with a non-zero exit |
| Config loader | Read `.code-quality.yml` and apply defaults | Validate the full schema, require a reason for every disabled check, and reject threshold overrides |
| Language detector | Inspect manifests and explicit config | Detect all matching languages unless `languages` overrides the result |
| Check registry | Map logical language/check IDs to concrete adapters | Keep one adapter interface and one pinned tool declaration per concrete tool-backed adapter |
| Temp config generator | Materialize policy plus consumer settings | Write tool configs only in a temporary directory and include only approved consumer controls |
| Process runner | Execute pinned binaries | Capture stdout/stderr, record artifacts, enforce exit status, and prevent an unexpected tool from passing |
| Anchor service | Convert diagnostic locations into structural paths | Use pinned web-tree-sitter WASM grammars and byte offsets, never line numbers, in normalized anchors |
| Snapshot service | Read and write `quality/<lang>-<check>-baseline.json` | Enforce schema version, tool version, config hash, and reduction-only semantics |
| Reporting service | Write comparisons and advisory reports | Write under `artifacts/quality/` and append Markdown to `GITHUB_STEP_SUMMARY` when set |
| Image entrypoint | Provide a reproducible local/CI runtime | Local runs use the image user `node` from `/work`; GitHub container jobs use root because GitHub Actions owns the workspace as root |

### Data flow

```text
consumer repository
        |
        v
load .code-quality.yml + detect manifests + resolve paths/excludes
        |
        v
select registry adapters -----> optional architecture rules files
        |
        v
generate policy/config files in a temporary directory
        |
        v
verify <binary>@<pinned version> -> run tool -> capture native output/artifacts
        |
        v
strict parser -> byte offset -> tree-sitter structural anchor -> Findings
        |
        +--> write comparison JSON and Markdown summary
        |
        v
read snapshot -> validate tool/config gates -> compare current with baseline
        |
        +--> check: pass or non-zero failure
        +--> update: write only when no regressions
        +--> initialize: write only when no snapshot exists
```

A tool process failure, malformed native output, unknown diagnostic, missing anchor, unexpected tool version, or hash mismatch is a check failure. An advisory report’s findings do not block, but inability to generate or parse that report does.

## 4. CLI commands and exit codes

The binary is named `code-quality`. All commands run with the current working directory as the consumer repository unless `--working-directory` is supplied by the workflow wrapper. The CLI accepts logical check IDs from the central registry; an omitted ID means all detected checks. A logical ID expands to all applicable concrete tool-backed adapters, and a failure in any expanded adapter fails the logical check.

| Command | Behavior | Writes to the consumer repository | Exit status |
| --- | --- | --- | --- |
| `check [ids...]` | Run selected detected checks, compare to existing snapshots, and block regressions and stale entries | No baseline writes; artifacts and summaries are written | `0` only when every selected check passes; `1` on any failure |
| `check [ids...] --update` | Compare selected checks and refresh existing snapshots only when there are no regressions | Rewrites only the selected baseline files after a successful comparison | `0` on successful rewrite; `1` on regression, mismatch, missing baseline, or any other failure |
| `check [ids...] --initialize` | Create selected snapshots from current findings | Creates a missing baseline; never replaces an existing file | `0` on successful creation; `1` if any target exists or another failure occurs |
| `baseline` | Equivalent to `check --update` for all detected checks | Rewrites existing baselines only after all selected comparisons have no regression | `0` or `1` using the update rules |
| `report` | Generate advisory Fallow health, semantic duplication, complexipy full output, and jscpd HTML reports | Writes reports under `artifacts/quality/`; does not change snapshots | `0` when reports are generated and parsed; `1` on tool or parsing failure |
| `init` | Scaffold consumer configuration, quality directory, caller workflow, and Makefile snippet; then initialize every detected check | Creates approved scaffold files and missing snapshots; never edits an existing Makefile | `0` only when every step succeeds; `1` on invalid config, existing target snapshot, or another failure |
| `versions` | Print every registered binary and the exact pinned/resolved version expected by v1 | No consumer writes | `0` when the registry can be read; `1` if version metadata is incomplete |
| `doctor` | Run version probes for every tool in the image, verify exact pins and required grammar assets, and report actionable failures | No consumer writes | `0` only when every required binary matches; `1` for any mismatch or missing runtime asset |

`--update` and `--initialize` are mutually exclusive. An update never creates a missing baseline; the user must explicitly initialize it. The reusable workflow invokes plain `check`. When the environment variable `GITHUB_ACTIONS` is `true`, the CLI refuses `--update`, `--initialize`, `baseline`, and `init` with an explicit error, so a committed snapshot can never change from CI. All failures, including an unknown ID or malformed YAML, use a non-zero exit code.

Every check run writes its comparison JSON and Markdown summary below `artifacts/quality/`. The summary reports the current count, the number of new or worsened findings, and the number of entries that can be tightened. When `GITHUB_STEP_SUMMARY` is set, the same Markdown is appended to that file.

## 5. Configuration (`.code-quality.yml`)

### Schema

The consumer configuration is YAML with only the following fields. An omitted field uses the stated default. Unknown fields, wrong types, empty language names, empty paths, and empty disable reasons are errors.

| Field | Type | Default and constraints |
| --- | --- | --- |
| `languages` | list of `ts`, `php`, `python` | All languages detected from manifests; this field is an explicit override and may include a subset of detected languages |
| `paths.ts` | list of repository-relative directory/file globs | Existing `src/` when TS/JS is detected; every configured path must be repository-relative |
| `paths.php` | list of repository-relative directory/file globs | Existing `src/`, plus existing `lib/` and `app/` when PHP is detected |
| `paths.python` | list of repository-relative directory/file globs | Existing `src/` when Python is detected |
| `exclude` | list of repository-relative glob patterns | No consumer exclusions; built-in test exclusions apply to every blocking check |
| `checks.disabled` | list of objects `{ id, reason }` | No checks disabled. `id` must be a registered check ID and `reason` must be non-empty prose |
| `architecture.ts.rulesFile` | repository-relative file path | Conventional `.dependency-cruiser.cjs` when it exists; otherwise architecture is skipped |
| `architecture.php.rulesFile` | repository-relative file path | Conventional `deptrac.yaml` when it exists; otherwise architecture is skipped |
| `architecture.python.rulesFile` | repository-relative file path | Conventional `.importlinter` when it exists; otherwise architecture is skipped |

The `architecture` entries select consumer-owned rule files; they do not change Runroom’s adapter, output validation, or baseline rules. If a `rulesFile` is explicitly configured but missing, the architecture check fails rather than silently skipping. If no architecture entry or conventional file exists, architecture is not a detected check for that language.

The full shape is:

```yaml
languages: [ts, php, python]
paths:
  ts: [src, packages/ui]
  php: [src, lib, app]
  python: [src]
exclude:
  - "**/generated/**"
  - "**/vendor/**"
  - "**/.venv/**"
checks:
  disabled:
    - id: architecture
      reason: "The repository has no approved dependency-layer rules yet."
architecture:
  ts:
    rulesFile: .dependency-cruiser.cjs
  php:
    rulesFile: deptrac.yaml
  python:
    rulesFile: .importlinter
```

This example does not change any threshold. A consumer may omit all fields and rely on manifest detection and the default paths, or use `paths` and `exclude` to define the source set. Tests are excluded from duplication regardless of consumer paths; the consumer’s `exclude` list applies to all applicable checks.

### Hashing and generated configuration

The CLI loads the immutable Runroom policy and the validated consumer configuration, then generates tool configurations into a temporary directory. The generated files are:

- Oxlint JSON configuration.
- PHPMD ruleset XML and PHPCS ruleset XML.
- Ruff command arguments/configuration, complexipy arguments, and jscpd JSON.
- Knip JSON configuration.
- Vulture and deptry arguments.

`configHash` is the SHA-256 digest of the policy version constant followed by canonical JSON for the validated consumer configuration. Canonical JSON has deterministic object-key ordering and deterministic array treatment according to schema order; semantically equivalent YAML formatting produces the same hash. The hash is recorded in each snapshot. A policy change, path change, exclude change, disabled-check change, or architecture-rule selection change therefore requires explicit regeneration.

Thresholds, tool selection, parser schema, built-in test exclusion, and baseline comparison rules are not consumer configuration fields and cannot be changed through this file.

## 6. Language detection

Without `languages`, detection examines manifests at the consumer repository root:

| Manifest | Detected language |
| --- | --- |
| `package.json` | `ts` (the TS adapter covers TypeScript and JavaScript) |
| `composer.json` | `php` |
| `pyproject.toml` or `setup.py` | `python` |

All matching manifests are enabled, so a repository may run more than one language’s checks. `.code-quality.yml.languages` is authoritative when present: it selects exactly the listed language adapters, subject to each language having a valid configured source path. Detection does not infer a language from arbitrary file extensions and does not install dependencies.

The default source roots are `src/` for each detected language, with PHP adding `lib/` and `app/` when those directories exist. Explicit `paths` replaces the default for that language. A missing manifest results in a clear configuration failure; a configured language without a usable source root fails before tools run. Generated files, dependencies, virtual environments, and consumer exclusions are removed from each tool’s candidate set according to the applicable tool configuration.

Architecture is separately detected from the presence of `.dependency-cruiser.cjs`, `deptrac.yaml`, or `.importlinter`, or from the corresponding explicit `architecture.*.rulesFile`. Its absence is a deliberate skip, not a passing empty report and not a baseline entry.

## 7. Checks per language

### Check matrix and fixed thresholds

The following thresholds are Runroom policy and are fixed in the image.

| Check ID | Language | Tool(s) | Policy |
| --- | --- | --- | --- |
| `complexity` | TS/JS | oxlint 1.82.0 | Complexity 10; max lines per function 60, skipping blank lines and comments; max parameters 4; max depth 3; max nested callbacks 3 |
| `complexity` | PHP | phpmd 2.15.0 and squizlabs/php_codesniffer 4.0.4 | CyclomaticComplexity report level 10; ExcessiveMethodLength minimum 60; ExcessiveParameterList minimum 4; PHPCS `Generic.Metrics.NestingLevel` nesting level 3 |
| `complexity` | Python | ruff 0.16.6 | C901 max-complexity 10; PLR0915 max-statements 60; PLR0913 max-args 4; PLR1702 max-nested-blocks 3 |
| `cognitive` | TS/JS | fallow 3.23.0 | Cognitive complexity 15 |
| `cognitive` | PHP | slevomat/coding-standard 8.31.1 through PHPCS | `SlevomatCodingStandard.Complexity.Cognitive` maxComplexity 15 |
| `cognitive` | Python | complexipy 8.0.1 | The Runroom cognitive-complexity policy threshold is 15 |
| `duplication` | TS/JS, PHP, Python | jscpd 5.2.0 | Mild mode, minimum 50 tokens and 5 lines; tests are excluded from every blocking check |
| `unused` | TS/JS | knip 6.35.1 | Unused files, exports, and dependencies |
| `unused` | PHP | composer-unused 0.9.6, composer-require-checker 4.24.0, phpstan 2.2.13 with shipmonk/dead-code-detector 1.4.0 | Unused packages, invalid/unused Composer requirements, and dead code according to the three tools |
| `unused` | Python | vulture 2.16 and deptry 0.25.1 | Unused code and dependency problems |
| `architecture` | TS/JS | dependency-cruiser 18.2.0 | Only when `.dependency-cruiser.cjs` or the configured rules file exists |
| `architecture` | PHP | deptrac 4.7.1 | Only when `deptrac.yaml` or the configured rules file exists |
| `architecture` | Python | import-linter 2.15 | Only when `.importlinter` or the configured rules file exists |

### Adapter contract and parser strictness

Each row is implemented by one or more concrete adapters when the row lists multiple tools. For example, PHP complexity expands to a PHPMD adapter and a PHPCS adapter, and PHP unused expands to the composer-unused, composer-require-checker, and PHPStan/dead-code adapters. Each concrete adapter implements the interface, declares one `tool` stamp, writes its own snapshot, and returns one `Findings` map. The CLI’s logical check result is the conjunction of those adapters. `configFiles(ctx)` generates the policy-constrained configuration in the temp directory. `run(ctx)` invokes the declared binary, captures the native output, validates its expected schema, converts locations to anchors, and returns normalized findings. Native output is retained under `artifacts/quality/` for review.

Every parser is strict. Required fields, tool-reported version/schema where available, diagnostic severity, and supported rule codes are validated. An unknown diagnostic, unexpected rule, unsupported output record, incomplete function report, invalid path, or duplicate normalized key is an error. This preserves the Bayer behavior in which an unrecognized diagnostic cannot be silently omitted from a baseline.

### Complexity adapters

#### TypeScript/JavaScript

The adapter generates an Oxlint quality configuration equivalent to the approved profile and runs the pinned binary over the resolved paths:

```text
oxlint -c <temporary>/oxlintrc.quality.json --format json <paths>
```

It parses Oxlint JSON diagnostics. It accepts only warning diagnostics for the supported metric codes and maps their messages to numeric measurements: `eslint(complexity)`, `eslint(max-params)`, `eslint(max-lines-per-function)`, `eslint(max-depth)`, and `eslint(max-nested-callbacks)`. It converts the first diagnostic label’s byte offset to an anchor; `max-depth` uses block mode and the other metrics use the containing function-like node. The key is `<file> | <Oxlint rule code> | <anchor>` and the value is the metric extracted from the native message. A second diagnostic producing the same key is ambiguous and fails.

#### PHP

The adapter runs PHPMD with a generated XML ruleset containing the three method thresholds and runs PHPCS with a generated XML ruleset containing `Generic.Metrics.NestingLevel` and the Slevomat cognitive rule where applicable:

```text
phpmd <paths> json <temporary>/phpmd-ruleset.xml
phpcs --report=json --standard=<temporary>/phpcs-ruleset.xml <paths>
```

PHPMD JSON violations map `CyclomaticComplexity`, `ExcessiveMethodLength`, and `ExcessiveParameterList` to their measured numeric values. PHPCS JSON violations map nesting and cognitive complexity to the numeric value in the native message/report. The file and line/column location become a byte offset in the PHP source and then a tree-sitter anchor. The key is `<file> | <native rule name> | <anchor>`; the value is the reported measurement. An invalid or unsupported PHPMD/PHPCS record fails.

#### Python

The adapter invokes Ruff with its generated arguments and machine-readable diagnostics:

```text
ruff check --output-format json <paths>
```

It maps C901, PLR0915, PLR0913, and PLR1702 to the corresponding policy measurements, using each diagnostic location to derive an anchor. The key is `<file> | <Ruff rule code> | <anchor>` and the value is the metric extracted from the validated diagnostic. The parser rejects an unrecognized rule or a message that does not contain the required measurement.

### Cognitive-complexity adapters

#### Fallow for TypeScript/JavaScript

The blocking adapter requests the pinned Fallow health report with cyclomatic and cognitive thresholds set to zero so the complete function report is emitted for comparison:

```text
fallow health --production --complexity --max-cyclomatic 0 --max-cognitive 0 \
  --report-only --no-cache --format json
```

The expected report has `kind: health`, the pinned Fallow version, schema version 11, a summary, and one record per analyzed function. The adapter refuses an incomplete report when the finding count differs from `functions_analyzed`. It retains findings whose cognitive value is greater than 15 and discards values at or below 15. It converts the report’s one-based line and zero-based column to a UTF-8 byte offset, then anchors the containing function-like node. The key is `<path> | cognitive-complexity | <anchor>` and the value is the cognitive score. The approved Fallow source behavior includes production discovery and disables telemetry.

The `report` command also emits Fallow’s full advisory health report. Its health findings do not block the command; process or parse failures do.

The generated Fallow policy retains the reference advisory settings: health reports use max cyclomatic complexity 10 and max cognitive complexity 15, while duplicate reporting uses semantic mode with near-miss matching and minimum 50 tokens/5 lines. These advisory duplicate values are separate from the exact jscpd blocking baseline.

#### PHP and Python

PHP cognitive findings are parsed from PHPCS JSON under `SlevomatCodingStandard.Complexity.Cognitive`, with the native numeric complexity and source location. The key is `<file> | cognitive-complexity | <anchor>` and the value is the measured score; values above 15 are current findings.

Python cognitive findings are parsed from the pinned complexipy machine-readable output configured by the adapter. The full native output is retained for `report`; the blocking parser accepts only the pinned report record shape, converts its file/line/column location to an anchor, and returns `<file> | cognitive-complexity | <anchor>` with the reported score as value. Values above 15 are findings, and unknown records or missing measurements fail.

### Duplication adapter

The same jscpd adapter runs for all three languages. It generates a JSON configuration equivalent to:

```json
{
  "mode": "mild",
  "minTokens": 50,
  "minLines": 5
}
```

The effective source set is the configured paths minus consumer exclusions and built-in test exclusions. The adapter invokes jscpd with a native baseline file in `artifacts/quality/`, never the committed quality snapshot, so the native tool’s `--update-baseline` behavior cannot accept new clones into the committed gate. It validates the JSON report’s source count and reads native fingerprints and occurrence counts. The normalized key is the native fingerprint exactly as emitted, and the value is its positive occurrence count. This is the explicit jscpd exception to the general `<file> | <rule> | <anchor>` key shape because the fingerprint is the stable identity produced by the native duplicate detector.

The check’s committed snapshot still uses the normal outer schema and `jscpd@5.2.0` tool identifier. The advisory `report` command additionally retains jscpd HTML and semantic/near-miss duplication output; advisory similarity does not alter the exact blocking baseline.

### Unused-code adapters

#### TypeScript/JavaScript with Knip

The adapter runs Knip with a generated JSON configuration over the selected project entries. It parses the pinned JSON reporter for unused files, exports, and dependencies. Presence findings use value `1`. Keys are stable normalized forms: `<file> | unused-file | <file-anchor>`, `<file> | unused-export | <export-anchor>`, and `<file> | unused-dependency | <dependency-anchor>`, where a native package/export identifier is used as the anchor when there is no source location. Every record must match one of those categories; unknown Knip diagnostics fail.

#### PHP with Composer and PHPStan tools

The adapter runs composer-unused, composer-require-checker, and PHPStan with the ShipMonk dead-code detector extension. Composer-unused and composer-require-checker outputs are parsed according to their pinned machine-readable or strict text reporter; PHPStan diagnostics are parsed from its machine-readable error report. The parser preserves the tool’s package, requirement, file, symbol, and rule identity in normalized anchors and assigns value `1` to each presence finding. The keys identify the category, for example `<file> | unused-package | <package>`, `<file> | invalid-requirement | <package>`, or `<file> | dead-code | <anchor>`. Unknown text lines are errors, not warnings. PHPStan cannot run without `vendor/`; the CLI reports that prerequisite and the workflow’s setup input is the supported way to install it.

#### Python with Vulture and deptry

Vulture’s text output is parsed strictly from the pinned native line format, including file, line, symbol/category, and confidence where present. Deptry’s JSON output is parsed for dependency diagnostics. Both are presence findings with value `1`. Vulture keys use `<file> | vulture-<category> | <symbol-anchor>`; deptry keys use `<file> | deptry-<rule> | <dependency-anchor>`. A line or JSON record outside the supported formats fails the check. The raw text and JSON outputs remain available in `artifacts/quality/`.

### Architecture adapters

Architecture is enabled only when the consumer provides the corresponding rules file. The adapters do not invent rules. Dependency-cruiser reads `.dependency-cruiser.cjs` (or the configured file), deptrac reads `deptrac.yaml` (or the configured file), and import-linter reads `.importlinter` (or the configured file). Each tool emits a machine-readable report when supported by the pinned binary; import-linter’s text output is parsed using a strict known-result format. A violation is a presence finding with value `1`, keyed by the source file and rule identifier plus a structural anchor when a source location exists. A package/module-only violation uses the stable native module identifier as its anchor. A missing explicitly named rules file, unsupported rule record, or malformed report fails; no rules file means the check is skipped.

## 8. Anchors

The anchor service replaces the TypeScript compiler AST used in the Bayer scripts with `web-tree-sitter` and pinned WASM grammars for TypeScript, TSX, JavaScript, PHP, and Python. The grammar WASM files are installed inside the runtime image and verified by `doctor`.

The public operation is:

```text
anchor(language, file, byteOffset, blockMode) -> structural path
```

The source is decoded as UTF-8. A tool’s one-based line and column are converted to a UTF-8 byte offset before parsing, following the same byte-offset treatment as the Fallow adapter. The anchor service finds the smallest relevant structural node containing that offset and walks its named ancestors. Function-like diagnostics use the containing function, method, or class method. Block diagnostics such as max depth use the containing statement/block mode. The exact node vocabulary is normalized across grammars to paths such as `/class:Foo/method:bar` and `/function:baz[1]`.

Names are included when the syntax provides them. An ordinal is included only when anonymous or same-labeled siblings collide; the ordinal is zero-based and applies within the matching sibling set. Paths do not include line numbers, columns, or byte offsets, so line shifts, comment changes, and blank-line changes preserve identity. Renames, moves, grammar-visible structural edits, and changes that alter anonymous sibling ordering may change an anchor and require explicit baseline regeneration.

If the byte offset cannot identify a valid node, the grammar cannot parse the file, or two diagnostics normalize to an ambiguous key, the check fails. A diagnostic is never dropped to make a baseline pass.

## 9. Baseline format and semantics

### Snapshot schema

Each detected concrete language/check adapter has one committed snapshot at `quality/<lang>-<check>-baseline.json`, for example `quality/ts-complexity-baseline.json`, `quality/php-complexity-phpmd-baseline.json`, or `quality/python-unused-baseline.json`. The `<check>-baseline.json` shorthand in the acceptance criteria is expanded with the language and, where a logical check uses multiple tools, the concrete adapter to prevent findings or tool stamps from sharing a file.

The outer snapshot is strict and has exactly these fields:

```json
{
  "version": 1,
  "tool": "<bin>@<version>",
  "configHash": "64 lowercase hexadecimal SHA-256 characters",
  "findings": {
    "<file> | <rule> | <anchor>": 1
  }
}
```

The angle-bracketed values describe schema positions, not accepted literal values. `version` must be integer literal `1`; `tool` is the adapter’s binary and exact pinned version; `configHash` is the computed SHA-256 digest; and every finding value is a positive integer. Unknown top-level fields, non-positive values, non-integer values, duplicate keys, or malformed JSON fail strict validation. jscpd stores native fingerprints as keys and positive occurrence counts as values under the same outer schema.

The normalized non-jscpd key is exactly:

```text
<file> | <rule> | <anchor>
```

The file is repository-relative, the rule is the normalized native rule/category, and the anchor is the structural path or a stable native identifier for findings without source locations. Measurements are the numeric value reported by the tool. Presence findings, including unused and architecture findings, have value `1`.

### Comparison rules

Let `B` be the committed baseline map and `C` be the current map.

- A key in `C` but not `B` is a regression: `new (value)`.
- A key in both maps with `C[key] > B[key]` is a regression: `old → new`.
- A key in both maps with equal values passes.
- A key in `B` with no current key, or with `C[key] < B[key]`, is stale.
- A stale key is not a regression, but stale entries fail ordinary `check` so cleanup is explicit and visible.
- A decrease cannot fund an increase at another key. Each key is compared independently.

Regression and stale lists are sorted before they are printed and written to artifacts. A new or increased finding always fails, even during an update. A reduction-only update can remove stale entries and lower measurements only after all regressions are absent.

### State machine

```text
                          existing snapshot
                         /                  \
                        /                    \
              --initialize                check/update
                    |                         |
             exists? |                         v
              yes -> fail              parse strict schema
              no  -> scan                    |
                    |             tool/version/hash match?
                    v                    no -> fail
              write current                    |
                                               yes
                                                |
                                                v
                                     scan and compare B -> C
                                      /          |          \
                             regression     no regression  |
                                  |               |         |
                           check/update fail      |       stale?
                                                  |       /    \
                                                  |     yes     no
                                                  |      |       |
                                           update write  check  pass
                                                        fail
```

The precise command transitions are:

| State/action | Required result |
| --- | --- |
| `check` with missing snapshot | Fail and instruct the user to run explicit initialization |
| `check` with malformed/unknown snapshot fields | Fail before comparison |
| `check` with tool or config hash mismatch | Fail and demand explicit regeneration; ordinary update cannot bypass it |
| `check` with regression | Fail; never write the snapshot |
| `check` with stale entries and no regression | Fail with the instruction to run baseline update; never write |
| `check` with equality | Pass; never write |
| `check --update` with regression | Fail; never write |
| `check --update` with no regression | Rewrite the current snapshot, thereby tightening removed/decreased entries |
| `check --initialize` with no existing file | Write current findings, including an empty findings object, and pass |
| `check --initialize` with an existing file | Fail without replacement |

Tool/version mismatch and config-hash mismatch are explicit regeneration events. The user removes or otherwise reviews the affected snapshot and invokes `--initialize`; the ordinary reduction-only update is not a policy-change mechanism. The reusable workflow always invokes plain `check`, so CI never updates or initializes baselines.

## 10. Docker image

### Build and runtime stages

The Dockerfile is multi-stage. The builder stage installs dependencies with pnpm, runs the TypeScript tests, and bundles the CLI with esbuild into the single `dist/cli.js` entrypoint. The runtime stage is `node:24-trixie-slim` and contains no build-only source or dependency tree beyond what the CLI and tools require.

The runtime installs these operating-system packages: `php8.4-cli`, `php8.4-mbstring`, `php8.4-xml`, `php8.4-intl`, `composer`, `python3`, `python3-venv`, and `git`. It installs the pinned TypeScript tools globally, PHP tools through isolated Composer projects with the exact versions below, and composer-unused and composer-require-checker through phar downloads with SHA-256 verification. Python tools are installed into `/opt/venv`. The image includes the pinned tree-sitter WASM grammars. Local runs use the image user `node`, `/work` as `WORKDIR`, and the `code-quality` entrypoint. GitHub container jobs override the user to root because GitHub Actions owns the mounted workspace as root.

### v1 tool pins

The v1 image uses exactly these pins:

| Family | Binary/package | Pin |
| --- | --- | --- |
| TS/JS | oxlint | 1.82.0 |
| TS/JS | fallow | 3.23.0 |
| TS/JS | jscpd | 5.2.0 |
| TS/JS | knip | 6.35.1 |
| TS/JS | dependency-cruiser | 18.2.0 |
| PHP | phpmd | 2.15.0 |
| PHP | squizlabs/php_codesniffer | 4.0.4 |
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
| Python | import-linter | 2.15 |

`versions` prints every binary and exact resolved value. `doctor` executes every version probe, verifies every value against the registry (all pins are exact strings; no release-line ranges), and verifies grammar assets. A build is not releasable until `doctor` passes.

The locked acceptance record contains an earlier TS/JS verification set (`oxlint` 1.75.0, `fallow` 3.21.0, `jscpd` 5.2.0, `knip` 6.32.2, and dependency-cruiser 18.1.0). The approved v1 design supersedes those preliminary values with the v1 matrix above; the invariant retained by the acceptance criterion is that the Docker build and `versions`/`doctor` output are exact and pinned. No consumer may choose between the two sets.

### Tags and access

Release images are published as immutable version tags `vX.Y.Z` and a moving major tag `vX`. Consumers pin v1 as `ghcr.io/runroom/code-quality:v1`. The GHCR package is internal to the Runroom organization, so workflow pulls use the GitHub actor and token credentials with package-read permission.

## 11. Reusable workflow, caller example, and `init` output

### Reusable workflow

`.github/workflows/quality.yml` is a reusable workflow triggered by `workflow_call`. Its canonical inputs are:

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `image-tag` | string | `v1` | Tag for the fixed `ghcr.io/runroom/code-quality` image |
| `checks` | string | `all detected` | Space-separated check IDs, or all detected checks |
| `setup` | string | empty | Shell command run before checking, such as `composer install` |
| `working-directory` | string | `.` | Consumer working directory inside `/work` |

The job runs in `container: image: ghcr.io/runroom/code-quality:${{ inputs.image-tag }}` with registry credentials `github.actor` and `github.token` and `options: --user root`, because GitHub container jobs own the workspace as root. The setup and checks inputs are passed through environment variables rather than expression interpolation. Before checking, a Bash validation step requires `checks` to match `^[a-z ]*$`, which excludes option injection such as `--update`. Its other steps are checkout with `fetch-depth: 0`, optional setup, `code-quality check` with the requested checks and working directory, and an always-run upload of `artifacts/quality/` retained for 14 days. The workflow never passes `--update` or `--initialize`. It exposes the code-quality summary through the job summary when the CLI sees `GITHUB_STEP_SUMMARY`.

### Caller example

The minimal generated caller is a workflow with this job:

```yaml
name: quality
on: [pull_request, push]
permissions: { contents: read, packages: read }
jobs:
  quality:
    uses: Runroom/code-quality/.github/workflows/quality.yml@v1
```

A consumer may add the supported inputs, for example `with: { checks: "complexity duplication unused", setup: "composer install", image-tag: "v1" }`, while preserving the same reusable workflow reference. The `@v1` reference is the consumer’s workflow version pin; the workflow fixes the image registry and repository while allowing the supported tag input.

### Local command and `init`

The documented local invocation is:

```sh
docker run --rm -v "$PWD:/work" ghcr.io/runroom/code-quality:v1 check
```

`code-quality init` detects the consumer languages and writes:

- `.code-quality.yml` with the detected language set and concrete source paths.
- `quality/`, including one baseline file per detected concrete tool-backed adapter after initialization.
- `.github/workflows/quality.yml` containing the caller reference to `Runroom/code-quality/.github/workflows/quality.yml@v1`.
- A `Makefile` only when one does not already exist, with `quality` and `quality-baseline` targets that invoke the v1 Docker image.

`init` never creates architecture rule files: writing a conventional rules file would enable the architecture check with rules nobody reviewed. `docs/quality-gate.md` carries starter templates for `.dependency-cruiser.cjs`, `deptrac.yaml`, and `.importlinter` that the consumer copies deliberately. If a Makefile already exists, `init` prints the exact target snippet for the user to review and does not edit that file. It then runs `check --initialize` for every detected check. Initialization refuses to replace any existing snapshot, so rerunning `init` is safe with respect to committed baselines and reports the existing-file condition instead of overwriting it.

The generated Makefile snippet is:

```make
quality:
	docker run --rm -v "$$PWD:/work" ghcr.io/runroom/code-quality:v1 check

quality-baseline:
	docker run --rm -v "$$PWD:/work" ghcr.io/runroom/code-quality:v1 baseline
```

## 12. Testing strategy

Tests are implemented with Vitest and run in the builder before the image is produced. They test behavior rather than a particular shell layout.

### Unit tests

- Baseline comparison covers new keys, increased measurements, equal measurements, lower measurements, removed keys, sorted regression/stale output, and the rule that a decrease cannot fund an increase.
- Snapshot validation covers the literal schema version, positive integer values, strict unknown-field rejection, tool string, and config hash.
- Anchor fixtures cover TypeScript, PHP, and Python functions, classes, methods, block diagnostics, line shifts, and anonymous siblings whose ordinals are required only on collision.
- Every adapter parser consumes native-output fixtures captured from the real pinned tool version. Fixtures cover valid reports, unknown diagnostics, malformed records, duplicate normalized keys, invalid locations, and incomplete function reports. The parsers throw on unknown diagnostics in the same way as the Bayer adapters.
- Config tests cover manifest detection, `.code-quality.yml` overrides, default paths, excludes, disabled-check reasons, architecture-file selection, canonical hashing, and temporary config generation.

### Integration fixtures

The repository contains three deliberately small and deliberately smelly projects:

```text
fixtures/ts-project/
fixtures/php-project/
fixtures/python-project/
```

Each fixture has its manifest, source tree, applicable consumer config, and committed baseline snapshots. CI builds the image and runs `check` against each fixture; each baseline check must pass. The integration suite then applies a controlled mutation that adds a complexity violation and asserts exit code `1`. Separate cases exercise duplication, unused findings, and optional architecture rules where their fixture contains the relevant file.

### Workflow and image verification

CI validates the reusable and release workflow YAML with actionlint and schema tests. The Docker test job runs the multi-stage build, invokes `versions` and `doctor`, and performs CLI smoke tests on all three fixtures. The workflow tests assert checkout depth, setup ordering, container image selection, artifact retention, and the absence of baseline-update flags in CI. The first tag push is the external verification of GHCR publication and a real caller pull; the workflow is structured so that this verification uses the same versioned and moving tags described in the release procedure.

## 13. Dogfooding

The code-quality repository has its own `ci.yml`. It runs TypeScript compilation, Oxlint, Vitest, actionlint, and the Docker build, then runs the newly built image’s `code-quality check` against the repository itself. The dogfood check uses empty baselines for every detected blocking check and must report zero findings. This makes any new quality finding in the CLI, adapters, workflows, or supporting files a failing change.

The dogfood job builds the image in the job and invokes that local image, so it verifies the image entrypoint, bundled CLI, installed tools, grammar assets, and `/work` mount together. The repository’s own workflow therefore tests both the distributable path and the local development path before a release tag is created.

## 14. Release and versioning

### Release workflow

`release.yml` runs on tags matching `v*`. It builds and pushes a multi-architecture image for `linux/amd64` and `linux/arm64` to GHCR, publishes `ghcr.io/runroom/code-quality:vX.Y.Z`, and moves `ghcr.io/runroom/code-quality:vX` to the released version. The package remains internal to the Runroom organization. Release workflow syntax is checked with actionlint before merge; image publication and consumer pull are verified on the first real tag push.

### Version policy

Consumers pin the major image tag `v1` and the reusable workflow reference `@v1`. The project’s CLI, snapshot schema, parser contracts, and policy are versioned together. A breaking CLI, snapshot, or policy contract starts a new major line; a compatible implementation change is released under the current major line.

A tool version bump is a policy change. The documented procedure is:

1. Change the pinned version in the registry/image build definition.
2. Capture new native-output fixtures from that exact image tool.
3. Run unit and integration tests plus `doctor`.
4. Build and release the new image tags.
5. Have consumers explicitly regenerate affected snapshots after reviewing changes; ordinary `--update` is not used to cross a tool-version gate.

The v1 project does not use Renovate. `doctor` is the final authority for the exact versions actually included in a build.

## 15. Documentation

`README.md` documents adoption in an existing repository and a new repository, the local Docker command, the reusable CI workflow, setup commands, check selection, baseline initialization and reduction-only refresh, artifacts, version pinning, and the tool-version bump procedure.

`docs/quality-gate.md` contains the per-language threshold table and explains that new or increased measurements fail, reductions become stale until refreshed, tool/config mismatches require explicit regeneration, and CI never updates baselines. It documents exact duplication mode and limits, the unused-code tools, architecture-file conventions, advisory reports, and the meaning of structural anchors. The docs explicitly distinguish blocking reports from advisory reports and explain the PHP `vendor/` prerequisite.

The documentation uses the v1 tool matrix from Section 10. It does not invite consumers to configure thresholds or to treat advisory similarity reports as the exact duplication gate.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| PHPStan dead-code analysis needs installed Composer dependencies | The PHP adapter checks for `vendor/` and fails with a direct message; workflow `setup` is documented with `composer install` as the normal preparation step |
| The multi-language image is large | Use a builder/runtime multi-stage image, omit build-only files, keep one bundle, install Python tools in one venv, and retain only required PHP/runtime packages |
| GHCR package is internal | Use `github.actor`/`github.token` container credentials, require package-read permission, document Runroom organization access, and verify a real caller pull on a tag push |
| Text-only tool outputs change or contain unexpected lines | Capture raw output, parse a strict pinned format, reject unknown lines/diagnostics, test native fixtures, and make the tool bump procedure recapture fixtures before release |
| Tree-sitter grammar drift changes anchors | Pin WASM grammars in the image, verify them with `doctor`, test named and anonymous fixtures for all languages, and treat grammar changes as explicit regeneration events |
| Tool versions drift from package metadata or global installs | Keep versions in the central registry and image installation, run `doctor` in build/release checks, and fail on any exact mismatch |
| Line-based identities churn after harmless edits | Convert locations to UTF-8 byte offsets and structural paths; do not store line numbers in keys; explain legitimate rename/move/anonymous-sibling changes in the regeneration procedure |
| Native output schema is incomplete or gains a new diagnostic | Require complete reports where the tool provides counts, validate schemas strictly, retain raw artifacts, and fail closed on unknown records |
| A native tool silently updates its own baseline | jscpd writes only an artifact-side native baseline during scanning; the committed snapshot is owned by the core comparator and is never updated by a tool flag |
| Consumers accidentally weaken policy | Keep thresholds and parser behavior in the image; restrict `.code-quality.yml` to the documented fields; reject threshold-like unknown fields and require disable reasons |
| Architecture configuration is missing or misidentified | Use conventional filenames plus explicit `rulesFile`, skip only when no file exists, and fail when a file is explicitly named but absent |
| A reduction hides a separate regression | Compare every normalized key independently and fail on any new/increased key before permitting an update |

## 17. Traceability to acceptance criteria 1–11

| Criterion | Design location | Verification evidence |
| --- | --- | --- |
| 1. Create the local `code-quality` repository and private Runroom remote, with no push | Sections 1, 10, and 14 define `github.com/Runroom/code-quality`, GHCR ownership, and the no-push development boundary | Repository setup verifies `git remote -v` and `gh repo view`; this design task performs no remote write or push |
| 2. Build a Docker image with pinned tools and print exact versions | Sections 10 and 14 define the multi-stage Node 24 image, all v1 pins, `versions`, and `doctor` | Docker build, `code-quality versions`, and `code-quality doctor`; the approved v1 pins supersede the preliminary TS/JS values recorded in the locked goal |
| 3. Provide the Node 24 `code-quality` CLI and required commands with non-zero failures | Sections 3, 4, and 10 define the bundled CLI, commands, exit codes, and runtime entrypoint | Vitest unit tests, fixture smoke tests, and CLI exit-status assertions |
| 4. Detect languages from manifests and allow `.code-quality.yml` override | Sections 5 and 6 define manifest mapping, language override, defaults, paths, and fixture coverage | TS, PHP, and Python fixture detection tests, including explicit language selection |
| 5. Use normalized baselines with stable anchors, reduction-only update, tool/hash gates, and CI immutability | Sections 7, 8, and 9 define key/value normalization, anchors, strict snapshots, comparison state machine, and no CI update | Baseline unit tests plus native-output adapter fixtures captured from pinned tools |
| 6. Provide a reusable workflow with `workflow_call`, setup/check/image inputs, artifacts, summary, and verification | Section 11 defines `image`, `checks`, `setup`, and `working-directory` inputs, container execution, setup ordering, upload, and summary | actionlint and workflow schema tests; the first real tag/caller pull verifies external GHCR E2E |
| 7. Make `init` generate local wrapper/workflow output and initialize all three fixture repositories | Section 11 defines the Docker invocation, config/quality/workflow/Makefile output, existing-Makefile rule, and explicit initialization | Run `init` in `fixtures/ts-project`, `fixtures/php-project`, and `fixtures/python-project`; each must create its baselines and pass `check` |
| 8. Preserve TS thresholds and document PHP/Python equivalents | Section 7 contains the fixed threshold matrix and per-language adapter rules; Section 15 assigns the same table to `docs/quality-gate.md` | Threshold assertions in generated configs and parser/integration tests |
| 9. Dogfood the repository with empty baselines and an image built in-job | Section 13 defines the own-repository zero-finding gate and `ci.yml` commands | Local dogfood run, in-job Docker build, code-quality check, and actionlint |
| 10. Publish a multi-architecture image from `release.yml` on `v*` | Section 14 defines tag trigger, amd64/arm64 build, GHCR tags, and access | actionlint plus the first real tag publication and pull |
| 11. Document adoption, local use, CI, baseline refresh, and versioning | Section 15 defines the required README and `docs/quality-gate.md` content | Documentation review checks every required topic and the v1 version procedure |
