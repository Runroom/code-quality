# Configuration

`.code-quality.yml` selects repository inputs. Policy settings such as thresholds, tool versions, parser strictness, and baseline comparison rules are not configurable; unknown keys and threshold-like settings are errors.

## Key reference

| Field | Type | Default and constraints |
| --- | --- | --- |
| `languages` | List of `ts`, `php`, `python`, `web` | Detected from manifests or web files; an explicit list replaces detection entirely. Configuring `paths.<language>` also enables that language when this list is absent. |
| `paths.ts` | Repository-relative directory or file globs | Existing `src/` and `assets/` when TS/JS is detected. |
| `paths.php` | Repository-relative directory or file globs | Existing `src/`, `lib/`, and `app/` when PHP is detected. |
| `paths.python` | Repository-relative directory or file globs | Existing `src/` when Python is detected. |
| `paths.web` | Repository-relative directory or file globs | Existing `templates/` and `assets/` directories. |
| `exclude` | Repository-relative glob patterns | Empty; adds to built-in exclusions. |
| `checks.disabled` | `{ id, reason }` objects | Empty; `id` is a logical check ID and `reason` must be non-empty prose. |
| `architecture.ts.rulesFile` | Repository-relative file path | `.dependency-cruiser.cjs` when present; otherwise architecture is skipped. |
| `architecture.php.rulesFile` | Repository-relative file path | `deptrac.yaml` when present; otherwise architecture is skipped. |
| `architecture.python.rulesFile` | Repository-relative file path | `.importlinter` when present; otherwise architecture is skipped. |
| `report.coverage` | Repository-relative Istanbul map or directory | Unset; available in code-quality 1.2.0 and newer. |

Every configured path must be repository-relative. A path cannot be empty, `.`, absolute, start with `-`, contain `:`, or contain a `..` segment; an explicitly configured architecture file that is missing is an error.

The logical check IDs are `complexity`, `cognitive`, `duplication`, `unused`, and `architecture`. With no command arguments, `check` runs every detected and enabled check; an architecture check is skipped when no conventional or configured rules file exists.

Example:

```yaml
languages: [php, ts, web]
paths:
  php: [src]
  ts: [assets]
  web: [templates, assets]
exclude:
  - "src/Migrations/**"
checks:
  disabled:
    - id: architecture
      reason: "Architecture rules are not defined yet"
report:
  coverage: coverage/coverage-final.json
```

The migration exclusion is optional and is useful when generated Doctrine migrations should not participate in the gate. An explicit `--coverage` flag takes precedence over `report.coverage`; see [Coverage for CRAP](checks.md#coverage-for-crap).

## Language detection and source roots

Without an explicit `languages` list, code-quality combines detected languages with languages enabled by `paths.<language>`:

| Language | Signal | Conventional roots |
| --- | --- | --- |
| TS/JS | `package.json` | Existing `src/` and `assets/` |
| PHP | `composer.json` | Existing `src/`, `lib/`, and `app/` |
| Python | `pyproject.toml` or `setup.py` | Existing `src/` |
| Web | `.twig`, `.html`, `.css`, `.scss`, or `.less` below `templates/` or `assets/` | Existing `templates/` and `assets/` directories |

Conventional roots with sources are kept and workspace roots from manifests are added: TS/JS from `pnpm-workspace.yaml`, `package.json` `workspaces`, and depth-1 directories with their own `package.json`; PHP from `composer.json` `autoload` directories; Python from `[tool.uv.workspace]` members and `[tool.setuptools.packages.find]` `where`. A TS member maps to `<member>/src` only when no source exists elsewhere in the member. Member patterns support literal segments, `*`, `**`, one `*` inside a segment, and `!` negations; other patterns are ignored. Without conventional roots, depth-1 discovery is unioned with workspace roots. A `Notice:` lists added roots and `init` writes them. Drupal keeps its curated PHP roots.

The Python target comes from the repository-root `.python-version`, then the root `project.requires-python`; if neither defines it, the highest target among `[tool.uv.workspace]` members is used. Targets newer than the image still use CPython 3.14 tools with a notice. A Python target is part of the configuration hash only when Python resolves. PHPStan infers the PHP version from `composer.json` `config.platform.php`.

A directory without a manifest inside a workspace container, such as `packages/scripts`, is not analysed unless listed in `paths.<language>`.

If discovery finds no roots, configuration loading omits the language and prints a `Notice:` explaining how to add `paths.<language>`. An explicitly listed language or explicit path still fails when it contains no source files.

The source walker skips files whose longest line exceeds 1,000 characters, names matching `[.-]min.(js|css)` such as `.min.js`, `-min.js`, `.min.css`, or `-min.css`, and versioned JavaScript bundles such as `swagger-ui-4.18.3.js`. Their exact repository-relative paths are excluded from every adapter; one `Notice:` lists up to five skipped files and reports any remaining count.

## Built-in exclusions

Every blocking check excludes tests, regardless of consumer paths:

- `**/*.test.*`, `**/*.spec.*`, and `**/__tests__/**`
- `**/tests/**` and `**/test/**`
- `**/*Test.php`
- `**/test_*.py`, `**/*_test.py`, and `**/conftest.py`

Dependency, virtual-environment, distribution, and artifact directories named `node_modules`, `vendor`, `.venv`, `dist`, and `artifacts` are excluded at any depth. Generated frontend bundles under `public/build`, `*.min.js`, and `*.min.css`, plus Symfony `var/` cache files, are also excluded. Consumer `exclude` patterns are additive and apply to applicable checks; tests remain excluded from duplication regardless of consumer paths.

## Drupal profile

When `composer.json` requires `drupal/core`, `drupal/core-recommended`, or another `drupal/core-*` package, code-quality detects custom code automatically:

- PHP uses existing custom modules, themes, and profiles under `web/` or `docroot/`.
- PHP checks also scan `.module`, `.theme`, `.install`, `.inc`, `.profile`, and `.engine` files with structural anchors.
- Web uses custom theme directories.
- TS/JS adds custom theme directories that contain JavaScript.
- Ordinary source-root discovery remains the fallback when no custom directory exists.

Drupal exclusions are `**/web/core/**`, `**/docroot/core/**`, `**/modules/contrib/**`, `**/themes/contrib/**`, `**/profiles/contrib/**`, `**/libraries/**`, `**/sites/*/files/**`, `**/drush/**`, and `**/ddev.provision/**`. A `Notice:` identifies the active Drupal defaults.

The normal complexity, cognitive-complexity, duplication, and architecture checks run for detected custom-code languages. With installed Composer dependencies, `composer-unused` and `composer-require-checker` also run; PHPStan dead-code analysis is skipped because consumer PHPStan extensions are incompatible with the image.

A Drupal repository normally needs no path override:

```yaml
# composer.json requires drupal/core-recommended
exclude:
  - "web/modules/custom/site/generated/**"
```

## Payload and Next profiles

Profiles are detected separately for the repository root and each workspace owner of a resolved TS root. `next.config.{js,mjs,cjs,ts,mts}` activates the Next profile, which excludes the owner's `.next/**` and `next-env.d.ts` only.

`payload.config.{ts,js,mjs,mts}` in the owner root or `src/`, or a `payload` dependency or dev dependency in that owner's `package.json`, activates the Payload profile. It excludes these paths under every TS root owned by that package:

- `<ts-root>/**/payload-types.ts`
- `<ts-root>/**/importMap.js`
- `<ts-root>/**/app/[(]payload[)]/**`
- `<ts-root>/**/migrations/**`
- `<ts-root>/**/migrations-*/**`
- `<ts-root>/**/seed/**`
A TS root named `app` also excludes `<ts-root>/[(]payload[)]/**`. One `Notice:` identifies each active profile kind and lists non-root owners. Dependency-cruiser does not apply exclude globs.

Payload exclusions scoped to a TS root also apply to other languages under the same directory.

## What `init` writes

Run `npx @runroom/code-quality init` once the first source and manifest files exist. It writes or updates:

- `.code-quality.yml` with detected languages and resolved paths, including workspace roots, unless the file already exists;
- missing `quality/<adapter-id>-baseline.json` files while keeping existing snapshots and reporting each as `● Kept existing quality/<adapter-id>-baseline.json`;
- `.github/workflows/quality.yml`, unless it already exists;
- a Makefile or an appended target block when safe; and
- the `artifacts/quality/` entry in `.gitignore`.

Review the generated languages, paths, workflow, and Makefile. In a new repository, commit `.code-quality.yml`, `quality/`, and the generated workflow from the first commit; its baselines normally start empty or small. `artifacts/quality/` is per-run evidence and is never committed.

`init` never invents architecture rules. Copy and review a starter template from [Architecture conventions](checks.md#architecture-conventions) when the repository is ready.

## Makefile behavior

The generated targets are:

| Target | Container command |
| --- | --- |
| `make quality` | `code-quality check` |
| `make quality-all` | `code-quality check --all` |
| `make quality-baseline` | `code-quality baseline` |
| `make quality-report` | `code-quality report` |
| `make quality-doctor` | `code-quality doctor` |

The snippet defines `CODE_QUALITY_IMAGE ?= ghcr.io/runroom/code-quality:v1` and mounts `$$PWD` at `/work`. The double dollar is Make escaping for `$PWD`, so run these targets through `make`.

If no Makefile exists, `init` creates `Makefile`. If one exists without quality targets, it appends the snippet while preserving its newline style.

If a Makefile already defines `CODE_QUALITY`, `init` leaves it untouched and reports the offending line when an existing quality recipe uses spaces instead of a required tab. If the Makefile instead has a quality target, a `.PHONY` quality entry, or a custom `.RECIPEPREFIX`, `init` leaves it untouched and prints the snippet for manual addition.
