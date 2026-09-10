import { loadRecord } from "../db/repo.ts";

export const view = (): string => loadRecord();
