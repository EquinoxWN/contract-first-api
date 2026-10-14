import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { main, MAX_FILES } from "../src/cli.js";
import type { Finding } from "../src/lint.js";
import { MUTATIONS, mutate } from "../src/mutations.js";
import { fails, render } from "../src/report.js";
import { captureIo, scratch, SPEC, specText } from "./helpers.js";

describe("contract CLI", () => {
  test("lint on the committed spec exits 0 and prints a clean summary", async () => {
    const { out, io } = captureIo();
    assert.equal(await main(["lint", SPEC], io), 0);
    assert.match(out.join("\n"), /70 rules, 0 errors, 0 warnings, 0 infos, 0 hints/);
  });

  test("lint on a spec with a style violation exits 1 and names the rule, line and path", async () => {
    const { dir, cleanup } = await scratch("cli");
    try {
      const property = MUTATIONS.find((m) => m.expected === "cfa-property-camel-case")!;
      const bad = join(dir, "bad.yaml");
      await writeFile(bad, mutate(await specText(), property, 7).text);
      const { out, io } = captureIo();
      assert.equal(await main(["lint", bad], io), 1);
      assert.match(out.join("\n"), /bad\.yaml:\d+:\d+ {2}error {2}cfa-property-camel-case {2}Property name "\S+" must be camelCase\. {2}\(components\.schemas\./);

      const json = captureIo();
      assert.equal(await main(["lint", "--format", "json", bad], json.io), 1);
      const report = JSON.parse(json.out.join("")) as { counts: { error: number }; findings: Finding[] };
      assert.equal(report.counts.error, report.findings.filter((f) => f.severity === "error").length);
      assert.ok(report.findings.some((f) => f.code === "cfa-property-camel-case"));
    } finally {
      await cleanup();
    }
  });

  test("--fail-on decides which severities fail the run", () => {
    const warn: Finding = { code: "x", severity: "warn", message: "m", source: "s", path: "", line: 1, column: 1 };
    assert.equal(fails([warn], "warn"), true);
    assert.equal(fails([warn], "error"), false);
    assert.equal(fails([{ ...warn, severity: "hint" }], "info"), false);
    assert.equal(fails([], "hint"), false);
  });

  test("github format escapes annotation data and ends with a summary annotation", () => {
    const finding: Finding = {
      code: "cfa-x",
      severity: "error",
      message: "50% bad\nsecond line",
      source: "dir,name:1.yaml",
      path: "paths",
      line: 3,
      column: 5,
    };
    const lines = render("github", "dir,name:1.yaml", [finding], 70).split("\n");
    assert.equal(lines[0], "::error file=dir%2Cname%3A1.yaml,line=3,col=5,title=cfa-x::50%25 bad%0Asecond line");
    assert.equal(lines[1], "::error title=contract lint::dir,name:1.yaml: 70 rules, 1 errors, 0 warnings, 0 infos, 0 hints");
    assert.match(render("github", "a.yaml", [], 70), /^::notice title=contract lint::a\.yaml: 70 rules, 0 errors/);
  });

  test("usage errors exit 2 with the usage text", async () => {
    const cases: string[][] = [
      [],
      ["deploy"],
      ["lint"],
      ["lint", "--format", "xml", SPEC],
      ["lint", "--fail-on", "fatal", SPEC],
      ["lint", "--root", ".", SPEC],
      ["lint", "--unknown", SPEC],
      ["check", "extra.yaml"],
      ["lint", ...Array.from({ length: MAX_FILES + 1 }, () => SPEC)],
    ];
    for (const args of cases) {
      const { err, io } = captureIo();
      assert.equal(await main(args, io), 2, args.join(" "));
      assert.match(err.join("\n"), /usage:/, args.join(" "));
    }
  });

  test("unreadable input exits 2 with the reason; --help exits 0", async () => {
    const { err, io } = captureIo();
    assert.equal(await main(["lint", "does-not-exist.yaml"], io), 2);
    assert.match(err.join("\n"), /does-not-exist\.yaml: cannot open \(ENOENT\)/);
    const help = captureIo();
    assert.equal(await main(["--help"], help.io), 0);
    assert.match(help.out.join("\n"), /contract check/);
  });
});
