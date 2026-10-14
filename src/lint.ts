import { Document, Spectral, type ISpectralDiagnostic } from "@stoplight/spectral-core";
import parsers from "@stoplight/spectral-parsers";
import { Resolver } from "@stoplight/spectral-ref-resolver";
import { readSpec, validateSpecText } from "./load.js";
import { ruleset } from "./ruleset.js";

export type Severity = "error" | "warn" | "info" | "hint";
/** Severities from most to least serious, indexed like Spectral's DiagnosticSeverity. */
export const SEVERITIES: readonly Severity[] = ["error", "warn", "info", "hint"];

/** One problem found in a spec. */
export interface Finding {
  code: string;
  severity: Severity;
  message: string;
  source: string;
  /** JSON path inside the document, for example `paths./orders.get`. */
  path: string;
  /** 1-based line and column. */
  line: number;
  column: number;
}

/** Linter with the house ruleset that never follows external `$ref`s (no file or network reads). */
export function createLinter(): Spectral {
  const spectral = new Spectral({ resolver: new Resolver({ resolvers: {} }) });
  spectral.setRuleset(ruleset);
  return spectral;
}

/** Number of rules the house ruleset runs (Spectral's plus the style guide). */
export function ruleCount(spectral: Spectral): number {
  return Object.keys(spectral.ruleset?.rules ?? {}).length;
}

/** Convert a Spectral diagnostic into a finding. */
function toFinding(d: ISpectralDiagnostic, source: string): Finding {
  return {
    code: String(d.code),
    severity: SEVERITIES[d.severity] ?? "error",
    message: d.message,
    source,
    path: d.path.map(String).join("."),
    line: d.range.start.line + 1,
    column: d.range.start.character + 1,
  };
}

/** Order findings by position, then rule code. */
function byPosition(a: Finding, b: Finding): number {
  return a.line - b.line || a.column - b.column || a.code.localeCompare(b.code);
}

/** Lint spec text already in memory. */
export async function lintText(text: string, source: string, spectral = createLinter()): Promise<Finding[]> {
  validateSpecText(text, source);
  const diagnostics = await spectral.run(new Document(text, parsers.Yaml, source));
  return diagnostics.map((d) => toFinding(d, source)).sort(byPosition);
}

/** Lint one spec file. */
export async function lintFile(file: string, spectral = createLinter()): Promise<Finding[]> {
  return lintText(await readSpec(file), file, spectral);
}
