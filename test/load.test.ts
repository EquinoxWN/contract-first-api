import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { lintFile, lintText } from "../src/lint.js";
import { MAX_ALIASES, MAX_SPEC_BYTES, readSpec, SpecError, validateSpecText } from "../src/load.js";
import { ROOT, scratch, SPEC } from "./helpers.js";

/** Assert that a call rejects with a SpecError whose message matches. */
async function rejectsSpec(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(fn, (error: unknown) => error instanceof SpecError && pattern.test(error.message));
}

describe("reading spec files safely", () => {
  test("reads the committed spec", async () => {
    assert.match(await readSpec(SPEC), /^openapi: 3\.1\.0$/m);
  });

  test("refuses missing files, directories and files over the size cap", async () => {
    const { dir, cleanup } = await scratch("load");
    try {
      await rejectsSpec(() => readSpec(join(dir, "missing.yaml")), /cannot open \(ENOENT\)/);
      await rejectsSpec(() => readSpec(dir), /not a regular file|cannot open/);
      const big = join(dir, "big.yaml");
      await writeFile(big, `openapi: 3.1.0\nx: "${"a".repeat(MAX_SPEC_BYTES)}"\n`);
      await rejectsSpec(() => readSpec(big), /larger than/);
    } finally {
      await cleanup();
    }
  });

  test("refuses invalid UTF-8 and accepts a byte-order mark", async () => {
    const { dir, cleanup } = await scratch("load");
    try {
      const bad = join(dir, "bad.yaml");
      await writeFile(bad, Buffer.from([0x6f, 0x70, 0x65, 0x6e, 0xff, 0xfe, 0x0a]));
      await rejectsSpec(() => readSpec(bad), /not valid UTF-8/);
      const bom = join(dir, "bom.yaml");
      await writeFile(bom, `﻿openapi: 3.1.0\ninfo: {title: t, version: "1"}\npaths: {}\n`);
      assert.match(await readSpec(bom), /^openapi/);
    } finally {
      await cleanup();
    }
  });

  test("refuses malformed or non-OpenAPI documents with a clear message", () => {
    const cases: [string, RegExp][] = [
      ["openapi: 3.1.0\nopenapi: 3.1.0\n", /unique|duplicate/i],
      ["openapi: 3.1.0\n---\nopenapi: 3.1.0\n", /exactly one YAML document, found 2/],
      ["- a\n- b\n", /root must be a mapping/],
      ["just text\n", /root must be a mapping/],
      ["info: {title: t}\n", /missing the "openapi"/],
      ["openapi: [unclosed\n", /.+/],
      ["", /exactly one YAML document, found 0/],
    ];
    for (const [text, pattern] of cases) {
      assert.throws(() => validateSpecText(text, "t.yaml"), (e: unknown) => e instanceof SpecError && pattern.test(e.message), text);
    }
  });

  test(`refuses YAML alias bombs (more than ${MAX_ALIASES} alias expansions)`, () => {
    const lines = ["openapi: 3.1.0", 'a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    for (let i = 1; i <= 8; i++) {
      const prev = String.fromCharCode(96 + i);
      const next = String.fromCharCode(97 + i);
      lines.push(`${next}: &${next} [${Array(10).fill(`*${prev}`).join(",")}]`);
    }
    const started = Date.now();
    assert.throws(() => validateSpecText(lines.join("\n"), "bomb.yaml"), (e: unknown) => e instanceof SpecError && /alias/i.test(e.message));
    assert.ok(Date.now() - started < 2000, "rejected quickly");
  });

  test("never follows external $refs: no HTTP request and no file read", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end("type: object\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { dir, cleanup } = await scratch("refs");
    try {
      const port = (server.address() as AddressInfo).port;
      const marker = join(dir, "marker.yaml");
      await writeFile(marker, "x:\n  type: object\n  description: MARKER-7f3a\n");
      const text = [
        "openapi: 3.1.0",
        "info: {title: t, version: '1'}",
        "paths: {}",
        "components:",
        "  schemas:",
        `    Remote: {$ref: 'http://127.0.0.1:${port}/schema.yaml'}`,
        `    Local: {$ref: '${marker.replaceAll("\\", "/")}#/x'}`,
        "    Relative: {$ref: './other.yaml#/x'}",
      ].join("\n");
      const findings = await lintText(text, join(dir, "refs.yaml"));
      assert.equal(requests, 0, "the linter made no HTTP request");
      const refErrors = findings.filter((f) => f.code === "invalid-ref" && f.severity === "error");
      assert.equal(refErrors.length, 3, JSON.stringify(findings));
      assert.ok(refErrors.every((f) => f.message.startsWith("No resolver defined for scheme")));
      assert.ok(findings.every((f) => !f.message.includes("MARKER")), "the local file was not read");
    } finally {
      server.close();
      await cleanup();
    }
  });

  test("lintFile reports input problems as SpecError, not as a crash", async () => {
    await rejectsSpec(() => lintFile(join(ROOT, "no-such-file.yaml")), /cannot open/);
  });
});
