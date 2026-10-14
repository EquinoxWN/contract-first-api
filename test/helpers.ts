import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (tests run from dist/test). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The committed OpenAPI document. */
export const SPEC = join(ROOT, "openapi", "openapi.yaml");

/** Text of the committed OpenAPI document. */
export function specText(): Promise<string> {
  return readFile(SPEC, "utf8");
}

/** A fresh scratch folder inside the repo's git-ignored .tmp, removed by the returned cleanup. */
export async function scratch(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const base = join(ROOT, ".tmp");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, `${prefix}-`));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Output sinks that collect what the CLI prints. */
export function captureIo(): { out: string[]; err: string[]; io: { out: (t: string) => void; err: (t: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t) => out.push(t), err: (t) => err.push(t) } };
}
