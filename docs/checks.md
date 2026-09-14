# Checks and policy

## Purpose and fixed policy

The gate makes incremental improvement enforceable in repositories with technical debt. A reviewed baseline records the current state; later checks reject new findings, increased measurements, stale baseline entries, invalid reports, and tool or configuration mismatches.

The image owns policy. Consumer configuration can select languages, paths, exclusions, disabled checks with reasons, and architecture rule files, but cannot change thresholds, tools, parser strictness, or comparison semantics.

## Thresholds by language

| Check | Language | Tool | Fixed threshold and semantics |
| --- | --- | --- | --- |
| Complexity | TS/JS | Oxlint 1.82.0 | Complexity 10; 60 lines per function excluding blanks and comments; 4 parameters; depth 3; 3 nested callbacks. Only warning diagnostics are accepted. |
| Complexity | PHP | PHPCS 4.0.4, Slevomat 8.31.1, Runroom standard | Cyclomatic complexity 10; nesting 3; function length 60; parameters 4. |
| Complexity | Python | Ruff 0.16.6 | C901 10; PLR0915 60 statements; PLR0913 4 arguments; PLR1702 3 nested blocks. |
| Cognitive | TS/JS | Fallow 3.23.0 | Values greater than 15 block. |
| Cognitive | PHP | Slevomat through PHPCS | `SlevomatCodingStandard.Complexity.Cognitive`; values greater than 15 block. |
| Cognitive | Python | complexipy 8.0.1 | SARIF `CC001`; values greater than 15 block, using the SARIF measurement and location. |
| Exact duplication | TS/JS, PHP, Python | jscpd 5.2.0 | Mild mode, at least 50 tokens and 5 lines; native fingerprints identify findings. |
| Exact duplication | Web | jscpd 5.2.0 | The only web check; Twig, HTML, CSS, SCSS, and Less in mild mode, at least 50 tokens and 5 lines. |
| Unused | TS/JS | Knip 6.35.1 | Unused files, exports, types, dependencies, and devDependencies. |
| Unused | PHP | composer-unused 0.9.6, composer-require-checker 4.24.0, PHPStan 2.2.13 with ShipMonk 1.4.0 | Unused packages, invalid or unused requirements, and dead code. |
| Unused | Python | Vulture 2.16, deptry 0.25.1 | Unused code and dependency problems. |
| Architecture | TS/JS | dependency-cruiser 18.2.0 | Runs only with `.dependency-cruiser.cjs` or a configured rules file. |
| Architecture | PHP | deptrac 4.7.1 | Runs only with `deptrac.yaml` or a configured rules file. |
| Architecture | Python | import-linter 2.15 | Runs only with `.importlinter` or a configured rules file. |

Built-in test, generated-file, and framework exclusions apply before these checks. See [Configuration](configuration.md#built-in-exclusions).

## v1 tool pins

`versions` prints the 15 binary pins and two library pins; `doctor` verifies them.

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

The two Composer library pins come from installed package metadata. Although they are not standalone binary probes, they remain part of the version contract.

## Baseline semantics

Each concrete adapter owns `quality/<adapter-id>-baseline.json`. A schema-version-1 snapshot contains its exact `tool@version` stamp, a SHA-256 configuration hash, and a sorted map of positive finding counts.

Comparison is per key; a reduction in one finding cannot fund an increase in another:

| Current state | Result |
| --- | --- |
| New key or increased value | Regression; `check` fails. |
| Equal value | Passes. |
| Missing key or decreased value | Stale; `check` fails until the baseline is tightened. |

- `baseline` and `check --update` write a tighter current snapshot only when no finding regresses.
- `check --initialize` writes a missing snapshot, including an empty findings map, but never replaces one.
- A tool-stamp or configuration-hash mismatch requires reviewed regeneration: remove the affected snapshot and run `check --initialize`.
- `init` creates missing baselines and keeps existing ones.
- `--update`, `--initialize`, `baseline`, and `init` refuse writes when `GITHUB_ACTIONS=true` or `CI` is `true`, `1`, or `yes`; the reusable workflow runs plain `check`.

Native parser errors, unknown records, incomplete reports, invalid paths, and duplicate normalized keys fail closed. Ordinary `--update` does not cross a tool-version or configuration-hash gate.

## Exact duplication

jscpd runs in mild mode with `minTokens: 50` and `minLines: 5`. Web scans the `twig`, `html`, `css`, `scss`, and `less` formats; test and consumer exclusions still apply.

Ordinary keys use `<file> | <rule> | <anchor>`. Duplication instead uses each native jscpd fingerprint as the key and its native occurrence count as the value.

Small repositories whose files fall below the detection window produce an empty baseline. A repository with no candidate source files fails during configuration resolution, before any adapter runs.

With `--artifacts <dir>`, native jscpd JSON reports and baselines remain under `<dir>/<adapter-id>/` for inspection. The committed quality snapshot still belongs to the code-quality comparator.

## Unused-code checks

Each unused-code tool has its own adapter, version stamp, and baseline:

- TS/JS uses Knip for unused files, exports, types, dependencies, and devDependencies.
- PHP uses composer-unused for packages, composer-require-checker for requirements, and PHPStan with ShipMonk for dead code.
- Python uses Vulture for unused symbols and deptry for dependency diagnostics.

Knip requires `node_modules/` only when `package.json` declares any dependency field (`dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`). Install with the repository's package manager before checking; the gate reports a missing install directly.

Knip disables configuration-executing plugins, so dependencies referenced only by tool configuration can appear unused and be baselined. Entry heuristics include conventional `index`, `main`, and `cli` files, files below `bin` directories in each source root, repository-level tests and test patterns, and scripts referenced from `package.json`, such as `node scripts/build.ts`.

PHP checks require a usable `vendor/` directory containing application dependencies and PHPStan context. Run `composer install` before checking; the gate reports a missing install directly.

PHPStan dead-code keys have the form `<file> | dead-code | <anchor>#<identifier>#<member>`. The member comes from the diagnostic's fully qualified `FQN::member` token, such as `$locales`, `run`, or `CONSTANT`.

Use the reusable workflow's [`setup` input](ci.md#dependency-setup) to install dependencies. See [Container users](security.md#container-users) for the authoritative runtime-user behavior.

## Architecture conventions

Architecture is consumer-owned. The gate uses `.dependency-cruiser.cjs`, `deptrac.yaml`, or `.importlinter`, or the corresponding configured `rulesFile`; no file means a deliberate skip, while an explicitly named missing file is an error.

Review these small starter conventions before enabling them.

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

Import-linter output is parsed strictly. Do not set `broken_contract_guidance`: its extra text is outside the supported normalized format and makes report parsing fail. Use `--artifacts <dir>` to retain raw logs while investigating a broken contract.

When a reported module cannot resolve to a source file, its stable key is `<module id> | import-linter:<contract>:unresolved | <upper>`.

## Structural anchors

Native locations become structural paths so line shifts, comments, and blank lines do not churn baselines. Examples include `/class:Foo/method:bar` and `/function:busy/if[11]/block/if`; anchors contain no line, column, or byte offset.

Names come from the syntax tree, with ordinals only for anonymous or same-labeled sibling collisions. Renames, moves between structural parents, grammar-visible edits, and reordered anonymous siblings can change an anchor and require reviewed initialization; invalid locations and ambiguous normalized keys fail.

For newer syntax rejected by a supported tree-sitter grammar, an anchor falls back to `~symbol` when the tool supplies a symbol, or `~L<line>` otherwise. One `Notice:` per affected file warns that these keys are less stable.

## Blocking and advisory reports

| Command | Role | Contents |
| --- | --- | --- |
| `check` | Blocking | Compares every adapter with its snapshot; regressions, stale entries, mismatches, parser errors, and tool failures return non-zero. |
| `report` | Advisory | Retains full Fallow health and semantic duplication, complexipy JSON, and jscpd HTML for investigation. |

Advisory similarity, complexity, health, and coverage-backed CRAP never change exact-duplication or complexity baselines and never accept a regression. A failing `report` command or workflow step still returns failure.

Fallow production discovery may scan the repository; blocking findings outside configured source paths are explicitly skipped.

## Output

`check` begins with the CLI version, detected languages, and adapter count. Each adapter has a status row followed by nested findings, then a compact block of passed and failed adapters, blocking findings, stale entries, skipped adapters, and the final result.

Locations use `file:line:col`, `file:line`, or `file`; duplication uses `a:start-end ↔ b:start-end`. Tags and precedence are:

| Tag | Meaning |
| --- | --- |
| `new` | The key is absent from the baseline. |
| `new?` | A duplication regression has no clone marked new; displayed clones are possible sources. |
| `worsened P → V` | The current value exceeds the baseline. |
| `stale (was P)` | The finding disappeared and the baseline needs tightening. |
| `improved P → V` | The current value decreased and the baseline needs tightening. |
| `baselined` | Unchanged current finding, shown by `check --all`. |

`new` and `new?` tags are bold red, worsened tags are red, stale and improved tags are yellow, and baselined tags are gray. Pass glyphs are green, failure glyphs and final failure totals are red, skips are dim, and headings or totals use bold where supported. `--color` and `--no-color` come first, then non-empty `NO_COLOR` disables color; any defined `FORCE_COLOR` decides next (`0` disables, every other value, including empty, enables), and only when it is unset can `GITHUB_ACTIONS=true` or a TTY stdout enable color.

stderr keeps one line per failing adapter, such as `ts-complexity: 2 regressions` or `ts-complexity: 3 stale entries; run code-quality baseline and commit the reduced baseline`. Non-fatal limits such as source discovery or grammar fallbacks use `Notice:` lines.

In GitHub Actions, each regression emits an `::error file=…` annotation and the current Markdown summary is appended to `GITHUB_STEP_SUMMARY` when available.

`check`, `baseline`, and `init` accept `--artifacts <dir>`. It retains raw output plus `stdout.log` and `stderr.log` for each adapter; without it, temporary adapter output and logs are removed.

`report --output <dir>` selects the advisory output directory and defaults to `artifacts/quality/`.

## Coverage for CRAP

`report --coverage <path>` supplies an Istanbul `coverage-final.json` map, or a directory containing that file, so Fallow uses measured coverage instead of the Fallow estimate. The repository-relative `report.coverage` key does the same in code-quality 1.2.0 and newer; the CLI flag wins.

Vitest can use either the V8 or Istanbul provider, but must enable its `json` coverage reporter. Jest's JSON reporter also writes the supported Istanbul map; raw V8 output is unsupported.

```sh
vitest run --coverage
npx @runroom/code-quality report --coverage coverage/coverage-final.json
```

Coverage paths that match no repository file produce a notice and CRAP stays estimated. Missing, empty, or malformed maps fail; so do invalid paths, symlink escapes, non-regular files, files larger than 256 MiB, and unsupported Windows-style or `file://` paths among the first 50 coverage keys. The path must be repository-relative and resolve through real paths inside the repository.

The coverage file's directory is excluded from Fallow scans unless it overlaps a configured source path, in which case only the coverage file is excluded. For artifact-based CI coverage, see [Coverage from a test job](ci.md#coverage-from-a-test-job).
