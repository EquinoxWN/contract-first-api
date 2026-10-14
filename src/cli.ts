#!/usr/bin/env node
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileSpec, staleFiles, writeEmitted } from "./compile.js";
import { createLinter, lintFile, ruleCount, SEVERITIES, type Finding, type Severity } from "./lint.js";
import { SpecError } from "./load.js";
import { fails, FORMATS, render, type Format } from "./report.js";

/** Most spec files one `lint` call accepts. */
export const MAX_FILES = 50;

const USAGE = `usage:
  contract build [--root DIR] [--format text|json|github] [--fail-on error|warn|info|hint]
      compile spec/main.tsp to OpenAPI 3.1, write it, then lint it
  contract check [--root DIR] [--format ...] [--fail-on ...]
      compile in memory, fail if the committed OpenAPI file is stale, then lint it
  contract lint FILE... [--format ...] [--fail-on ...]
      lint OpenAPI files against the style guide

exit codes: 0 clean, 1 findings at or above --fail-on (default warn) or a stale/failed build, 2 usage or input error`;

/** Wrong command-line usage. */
class UsageError extends Error {}

/** Text sinks, so tests can capture output. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const stdio: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

/** Pick a value from an allowed list or fail with usage. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, flag: string): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`${flag} must be one of: ${allowed.join(", ")}`);
}

/** Lint files and print each report; returns true when any fails the threshold. */
async function lintAll(files: string[], format: Format, failOn: Severity, io: Io): Promise<boolean> {
  const spectral = createLinter();
  const rules = ruleCount(spectral);
  let failed = false;
  for (const file of files) {
    const findings: Finding[] = await lintFile(file, spectral);
    io.out(render(format, file, findings, rules));
    failed = fails(findings, failOn) || failed;
  }
  return failed;
}

/** Run the CLI and return its exit code. */
export async function main(argv: string[], io: Io = stdio): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        root: { type: "string" },
        format: { type: "string" },
        "fail-on": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      io.out(USAGE);
      return 0;
    }
    const [command, ...rest] = positionals;
    const format = oneOf(values.format, FORMATS, "text", "--format");
    const failOn = oneOf(values["fail-on"], SEVERITIES, "warn", "--fail-on");
    if (command === "lint") {
      if (values.root !== undefined) throw new UsageError("lint does not take --root");
      if (rest.length === 0) throw new UsageError("lint needs at least one file");
      if (rest.length > MAX_FILES) throw new UsageError(`lint takes at most ${MAX_FILES} files`);
      return (await lintAll(rest, format, failOn, io)) ? 1 : 0;
    }
    if (command !== "build" && command !== "check") throw new UsageError(`unknown command: ${command ?? "(none)"}`);
    if (rest.length > 0) throw new UsageError(`${command} takes no file arguments`);
    const root = resolve(values.root ?? ".");
    const { files, diagnostics } = await compileSpec(root);
    if (diagnostics.length > 0 || files.size === 0) {
      for (const d of diagnostics) io.err(d);
      io.err(`TypeSpec compile failed: ${diagnostics.length} diagnostics, ${files.size} files emitted`);
      return 1;
    }
    if (command === "build") {
      for (const rel of await writeEmitted(root, files)) io.err(`wrote ${rel}`);
    } else {
      const stale = await staleFiles(root, files);
      if (stale.length > 0) {
        io.err(`out of date with spec/: ${stale.join(", ")} (run \`make spec\` and commit the result)`);
        if (format === "github") io.out(`::error title=contract check::${stale.join(", ")} is out of date with spec/`);
        return 1;
      }
      io.err(`up to date: ${[...files.keys()].join(", ")}`);
    }
    const emitted = [...files.keys()]
      .filter((rel) => /\.(ya?ml|json)$/.test(rel))
      .map((rel) => relative(process.cwd(), resolve(root, rel)).split("\\").join("/"));
    return (await lintAll(emitted, format, failOn, io)) ? 1 : 0;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (error instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS"))) {
      io.err(`${(error as Error).message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof SpecError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
