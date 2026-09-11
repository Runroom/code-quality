export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  gray(s: string): string;
}

function identity(s: string): string { return s; }
function ansi(open: number, close: number): (s: string) => string {
  return (s) => `\u001B[${open}m${s}\u001B[${close}m`;
}

export function createStyle(enabled: boolean): Style {
  if (!enabled) {
    return {
      bold: identity,
      dim: identity,
      red: identity,
      green: identity,
      yellow: identity,
      gray: identity,
    };
  }
  return {
    bold: ansi(1, 22),
    dim: ansi(2, 22),
    red: ansi(31, 39),
    green: ansi(32, 39),
    yellow: ansi(33, 39),
    gray: ansi(90, 39),
  };
}

export const GLYPH = { pass: "✔", fail: "✖", bullet: "●", branch: "└", skip: "–" } as const;

export function colorFlagFromArgv(argv: readonly string[]): boolean | undefined {
  let flag: boolean | undefined;
  for (const argument of argv.slice(2)) {
    if (argument === "--") break;
    if (argument === "--color") flag = true;
    if (argument === "--no-color") flag = false;
  }
  return flag;
}

export function resolveColor(input: {
  flag?: boolean | undefined;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
}): boolean {
  if (input.flag !== undefined) return input.flag;
  if (input.env.NO_COLOR) return false;
  if (input.env.FORCE_COLOR !== undefined) return input.env.FORCE_COLOR !== "0";
  if (input.env.GITHUB_ACTIONS === "true") return true;
  return input.isTTY;
}
