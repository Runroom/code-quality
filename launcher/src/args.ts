import { constants } from "node:os";

const IMAGE_REPOSITORY = "ghcr.io/runroom/code-quality";
const IMAGE_REFERENCE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/u;

export class LauncherError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
  }
}

export interface LaunchContext {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  uid?: number;
  gid?: number;
  image: string;
}

export function imageFor(version: string, env: NodeJS.ProcessEnv): string {
  const image = env.CODE_QUALITY_IMAGE;
  if (!image) return `${IMAGE_REPOSITORY}:v${version}`;
  if (!IMAGE_REFERENCE.test(image)) {
    throw new LauncherError(
      `Invalid CODE_QUALITY_IMAGE "${image}": expected an image reference such as ghcr.io/runroom/code-quality:v1`,
    );
  }
  return image;
}

export function assertMountableCwd(cwd: string): void {
  if (cwd.includes(":")) {
    throw new LauncherError(
      `Working directory "${cwd}" contains ":" and cannot be bind-mounted; run from a path without colons`,
      2,
    );
  }
}

export function buildDockerArgs(ctx: LaunchContext): string[] {
  const args = ["run", "--rm", "-v", `${ctx.cwd}:/work`];
  if (ctx.platform === "linux" && ctx.uid !== undefined && ctx.gid !== undefined) {
    args.push("--user", `${ctx.uid}:${ctx.gid}`);
  }
  for (const name of ["CI", "GITHUB_ACTIONS"] as const) {
    if (ctx.env[name] !== undefined) args.push("-e", name);
  }
  args.push(ctx.image, ...ctx.argv);
  return args;
}

export function dockerHint(image: string): string {
  return `docker not found. @runroom/code-quality runs the pinned image and needs Docker (https://docs.docker.com/get-docker/). Equivalent command: docker run --rm -v "$PWD:/work" ${image} <args>`;
}

interface SpawnOutcome {
  error?: NodeJS.ErrnoException | undefined;
  status: number | null;
  signal: NodeJS.Signals | null;
}

export function resolveOutcome(
  result: SpawnOutcome,
  image: string,
): { exitCode: number; message?: string } {
  if (result.error) {
    const message = result.error.code === "ENOENT"
      ? dockerHint(image)
      : `docker could not start (${result.error.code ?? result.error.message}). ${dockerHint(image)}`;
    return { exitCode: 127, message };
  }
  if (result.signal) return { exitCode: 128 + (constants.signals[result.signal] ?? 2) };
  return { exitCode: result.status ?? 1 };
}
