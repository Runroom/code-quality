# Security

code-quality analyzes untrusted repository content with tools that may execute consumer configuration. Review the image, setup commands, configuration files, and image overrides as part of the repository's trust boundary.

## Execution boundary

- dependency-cruiser configuration and import-linter imports can execute consumer code inside the container.
- A reusable-workflow `setup` command, such as `composer install`, executes consumer code inside the job container.
- Knip runs with configuration-executing plugins disabled; its plugin toggles are generated from the complete plugin registry of the pinned Knip version and verified by a test. Framework entry points are matched as static file patterns and parsed, never executed, but other supported tools can still load repository configuration where their operation requires it.
- Local launcher containers bind-mount the current repository at `/work` read-write.

## Container users

- The image runs as its non-root `node` user by default.
- On Linux, the launcher passes `--user <uid>:<gid>` so files written into the mounted repository remain owned by the invoking user.
- GitHub container jobs run as root because GitHub Actions owns the mounted workspace; the reusable workflow sets `options: --user root`.

## Environment handling

- `/opt/corepack`, `/opt/python`, and `/opt/venv314` are root-owned and read-only for the `node` user. Under the reusable workflow (`--user root`), a setup command can write them, and anything cached there remains in scope for the rest of the job; the consumer `packageManager` field selects what corepack resolves.
- Tool subprocesses receive an allow-list plus constant and invocation-specific values, not the complete parent environment.
- The npm launcher forwards `CI`, `GITHUB_ACTIONS`, `NO_COLOR`, and `FORCE_COLOR` into the analysis container.
- When host stdout is a TTY and neither `NO_COLOR` nor `FORCE_COLOR` is set, the launcher injects `FORCE_COLOR=1`; it invokes `docker run` without `-t`, so container stdout is never a TTY.
- The Docker client inherits the launcher's full environment because the launcher does not replace it when spawning Docker; `DOCKER_HOST` and `DOCKER_CONTEXT` are the security-relevant variables.
- Treat a remote Docker daemon selected by those variables as part of the same trust boundary.

## Image selection

- The reusable workflow fixes the registry and repository to `ghcr.io/runroom/code-quality`; callers can set only `image-tag`.
- The workflow validates check IDs as lowercase space-separated values and validates coverage artifact names before use.
- Launcher X.Y.Z normally selects the tag `ghcr.io/runroom/code-quality:vX.Y.Z`.
- `CODE_QUALITY_IMAGE` replaces the launcher's entire image reference and is validated only for syntactic shape, not publisher or contents; the accepted shape includes digest references such as `ghcr.io/runroom/code-quality@sha256:<digest>`.
- Set `CODE_QUALITY_IMAGE` only to a trusted image because that image receives a read-write repository mount.
- The default launcher image uses a tag rather than a digest; `CODE_QUALITY_IMAGE` can select a digest.

## Consumer paths and coverage

- Consumer paths must be repository-relative and reject option-like values, colons, absolute paths, empty or `.` paths, and parent-directory traversal.
- An explicitly configured architecture rules file must exist.
- A coverage path must be repository-relative.
- Coverage resolution follows real paths and requires the resulting path to remain inside the repository, preventing symlink escape.
- Coverage input must be a regular file and no larger than 256 MiB.
- Missing, unreadable, or malformed Istanbul maps fail rather than silently changing measured results.
- A path that matches no repository file emits a notice and leaves advisory CRAP estimated.

## Supply-chain limits

- The v1 image pins all documented top-level tools.
- Global npm packages' transitive dependencies and Python packages are pinned only at the top level.
- Composer dependencies are fully locked.
- Downloaded phars are pinned and checksum-verified.
- uv is installed from PyPI by version pin without a hash.
- CPython 3.14.7 integrity relies on uv's bundled download metadata.
- `corepack prepare` specifications carry no integrity hash.
- These are accepted v1 limits; a tool-version change is a reviewed policy change, not an automatic baseline update.
