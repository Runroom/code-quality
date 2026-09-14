import { posix } from "node:path";

import { z } from "zod";

export const LANGUAGES = ["ts", "php", "python", "web"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LOGICAL_IDS = [
  "complexity",
  "cognitive",
  "duplication",
  "unused",
  "architecture",
] as const;
export type LogicalCheckId = (typeof LOGICAL_IDS)[number];

export function isRelativePath(path: string): boolean {
  const normalized = posix.normalize(path);
  const hasParentSegment = path.split("/").includes("..");
  return !path.startsWith("-") && !path.includes(":") && !path.startsWith("/") &&
    !hasParentSegment && normalized !== "" && normalized !== "." && !normalized.startsWith("..");
}

const relativePath = z.string().min(1).refine(
  isRelativePath,
  "must be repository-relative and must not start with -",
);

const pathsSchema = z.strictObject({
  ts: z.array(relativePath).min(1).optional(),
  php: z.array(relativePath).min(1).optional(),
  python: z.array(relativePath).min(1).optional(),
  web: z.array(relativePath).min(1).optional(),
});

const disabledCheckSchema = z.strictObject({
  id: z.enum(LOGICAL_IDS),
  reason: z.string().trim().min(1),
});

const architectureSchema = z.strictObject({
  ts: z.strictObject({ rulesFile: relativePath }).optional(),
  php: z.strictObject({ rulesFile: relativePath }).optional(),
  python: z.strictObject({ rulesFile: relativePath }).optional(),
});

export const consumerConfigSchema = z.strictObject({
  languages: z.array(z.enum(LANGUAGES)).min(1).optional(),
  paths: pathsSchema.optional(),
  exclude: z.array(relativePath).optional(),
  checks: z.strictObject({ disabled: z.array(disabledCheckSchema) }).optional(),
  architecture: architectureSchema.optional(),
  report: z.strictObject({ coverage: relativePath.optional() }).optional(),
});

export type ConsumerConfig = z.infer<typeof consumerConfigSchema>;
