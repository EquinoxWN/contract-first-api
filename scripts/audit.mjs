// npm audit that fails on every advisory except the reviewed entries in ACCEPTED (exact package version).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Advisories reviewed as not exploitable here; each entry is pinned to the installed version. */
const ACCEPTED = [
  {
    id: "GHSA-g3hv-75wg-m249",
    name: "minimatch",
    version: "3.1.5",
    reason:
      "range <11.0.1 is broader than the bug: firstPhasePreProcess/optimizationLevel do not exist in 3.1.5; " +
      "spectral-core 1.24.0 (latest) pins ^3.1.4 and only matches ruleset `overrides` patterns, which this ruleset does not use",
  },
];

/** Run npm audit and return its JSON report (npm exits 1 when it finds anything). */
function auditReport() {
  try {
    return JSON.parse(execSync("npm audit --json", { encoding: "utf8", timeout: 120_000 }));
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.trim().startsWith("{")) return JSON.parse(error.stdout);
    throw error;
  }
}

/** Installed version of a package at an npm audit node path. */
function installedVersion(node) {
  return JSON.parse(readFileSync(`${node}/package.json`, "utf8")).version;
}

const report = auditReport();
if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error)}`);
const problems = [];
const accepted = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === "string") continue; // reported through a dependency; that advisory is checked on its own entry
    const id = String(via.url ?? "").split("/").at(-1);
    const rule = ACCEPTED.find((a) => a.id === id && a.name === name);
    const versions = [...new Set(vuln.nodes.map(installedVersion))];
    if (rule && versions.every((v) => v === rule.version)) accepted.push(`${id} ${name}@${rule.version}`);
    else problems.push(`${id} ${name}@${versions.join(",")} (${via.severity}): ${via.title}`);
  }
}
for (const line of accepted) console.log(`accepted: ${line}`);
for (const line of problems) console.log(`vulnerable: ${line}`);
console.log(`npm audit: ${problems.length} unaccepted advisories, ${accepted.length} accepted (see scripts/audit.mjs)`);
process.exitCode = problems.length > 0 ? 1 : 0;
