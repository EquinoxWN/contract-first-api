import { SEVERITIES, type Finding, type Severity } from "./lint.js";

export type Format = "text" | "json" | "github";
export const FORMATS: readonly Format[] = ["text", "json", "github"];

/** Count of findings per severity. */
export type Counts = Record<Severity, number>;

/** Count findings by severity. */
export function countBySeverity(findings: readonly Finding[]): Counts {
  const counts: Counts = { error: 0, warn: 0, info: 0, hint: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** True when any finding is at least as serious as the threshold. */
export function fails(findings: readonly Finding[], failOn: Severity): boolean {
  const limit = SEVERITIES.indexOf(failOn);
  return findings.some((f) => SEVERITIES.indexOf(f.severity) <= limit);
}

/** One-line summary of counts. */
export function summary(counts: Counts): string {
  return `${counts.error} errors, ${counts.warn} warnings, ${counts.info} infos, ${counts.hint} hints`;
}

/** Escape a GitHub workflow-command message. */
function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** Escape a GitHub workflow-command property value. */
function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** GitHub annotation level for a severity. */
function annotationLevel(severity: Severity): "error" | "warning" | "notice" {
  if (severity === "error") return "error";
  return severity === "warn" ? "warning" : "notice";
}

/** Render findings for one file in the chosen format. */
export function render(format: Format, source: string, findings: readonly Finding[], rules: number): string {
  const counts = countBySeverity(findings);
  if (format === "json") return JSON.stringify({ source, rules, counts, findings }, null, 2);
  if (format === "github") {
    const lines = findings.map(
      (f) =>
        `::${annotationLevel(f.severity)} file=${escapeProperty(f.source)},line=${f.line},col=${f.column},` +
        `title=${escapeProperty(f.code)}::${escapeData(f.message)}`,
    );
    const level = counts.error > 0 ? "error" : "notice";
    lines.push(`::${level} title=${escapeProperty("contract lint")}::${escapeData(`${source}: ${rules} rules, ${summary(counts)}`)}`);
    return lines.join("\n");
  }
  const lines = findings.map(
    (f) => `${f.source}:${f.line}:${f.column}  ${f.severity.padEnd(5)}  ${f.code}  ${f.message}  (${f.path})`,
  );
  lines.push(`${source}: ${rules} rules, ${summary(counts)}`);
  return lines.join("\n");
}
