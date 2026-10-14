import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { compileSpec } from "./compile.js";
import { createLinter, lintText, ruleCount, type Finding } from "./lint.js";
import { MUTATIONS, mutate } from "./mutations.js";
import { countBySeverity, summary } from "./report.js";
import { STYLE_GUIDE, type Category } from "./ruleset.js";

/** Seeds per mutation kind in the detection campaign. */
export const SEEDS_PER_KIND = 10;
/** Timed repetitions of compile and lint. */
const RUNS = 5;

/** Median of a list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Milliseconds taken by an async call, with its result. */
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  return [result, performance.now() - start];
}

/** Count house-rule findings per style-guide category. */
function byCategory(findings: Finding[]): Record<Category | "spectral", number> {
  const counts: Record<Category | "spectral", number> = { version: 0, naming: 0, pagination: 0, errors: 0, spectral: 0 };
  for (const f of findings) counts[STYLE_GUIDE[f.code]?.category ?? "spectral"] += 1;
  return counts;
}

/** Compile the project at root and return its one emitted OpenAPI document. */
async function compileOne(root: string): Promise<string> {
  const { files, diagnostics } = await compileSpec(root);
  const text = [...files.values()][0];
  if (diagnostics.length > 0 || text === undefined) throw new Error(`compile of ${root} failed:\n${diagnostics.join("\n")}`);
  return text;
}

/** Measure compile and lint time, the first-draft baseline and seeded-violation detection. */
export async function measure(root: string): Promise<string[]> {
  const spectral = createLinter();
  const compileMs: number[] = [];
  const lintMs: number[] = [];
  let findings: Finding[] = [];
  for (let i = 0; i < RUNS; i++) {
    const [, c] = await timed(() => compileOne(root));
    compileMs.push(c);
    const committed = await readFile(resolve(root, "openapi/openapi.yaml"), "utf8");
    const [f, l] = await timed(() => lintText(committed, "openapi/openapi.yaml", spectral));
    lintMs.push(l);
    findings = f;
  }
  const spec = await readFile(resolve(root, "openapi/openapi.yaml"), "utf8");
  const draft = await lintText(await compileOne(resolve(root, "test/fixtures/draft")), "draft", spectral);
  const draftCounts = countBySeverity(draft);
  const draftCats = byCategory(draft);

  const rows: string[] = [];
  let caught = 0;
  let total = 0;
  for (const mutation of MUTATIONS) {
    let hits = 0;
    for (let seed = 1; seed <= SEEDS_PER_KIND; seed++) {
      const { text } = mutate(spec, mutation, seed);
      const codes = new Set((await lintText(text, "mutant", spectral)).map((f) => f.code));
      if (codes.has(mutation.expected)) hits += 1;
    }
    caught += hits;
    total += SEEDS_PER_KIND;
    rows.push(`| ${mutation.kind} | \`${mutation.expected}\` | ${hits}/${SEEDS_PER_KIND} |`);
  }
  const fmt = (ms: number[]): string => `${median(ms).toFixed(0)} ms (max ${Math.max(...ms).toFixed(0)} ms)`;
  return [
    `| Measure | Result |`,
    `|---|---|`,
    `| Rules run (Spectral recommended + house) | ${ruleCount(spectral)} (${Object.keys(STYLE_GUIDE).length} house) |`,
    `| Committed spec findings | ${summary(countBySeverity(findings))} |`,
    `| First draft findings | ${summary(draftCounts)} |`,
    `| First draft by area | naming ${draftCats.naming}, pagination ${draftCats.pagination}, errors ${draftCats.errors}, version ${draftCats.version}, Spectral recommended ${draftCats.spectral} |`,
    `| TypeSpec compile, median of ${RUNS} | ${fmt(compileMs)} |`,
    `| Lint, median of ${RUNS} | ${fmt(lintMs)} |`,
    `| Seeded violations caught | ${caught}/${total} |`,
    ``,
    `| Seeded violation | Rule expected | Caught |`,
    `|---|---|---|`,
    ...rows,
  ];
}

if (import.meta.main) {
  const lines = await measure(process.cwd());
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.argv.includes("--github")) {
    const caught = lines.find((l) => l.startsWith("| Seeded violations caught"))?.split("|")[2]?.trim() ?? "?";
    const draft = lines.find((l) => l.startsWith("| First draft findings"))?.split("|")[2]?.trim() ?? "?";
    process.stdout.write(`::notice title=style guide measure::seeded violations caught ${caught}; first draft: ${draft}\n`);
  }
}
