import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { parse, stringify } from "yaml";
import { createLinter, lintText } from "../src/lint.js";
import { MUTATIONS, mutate } from "../src/mutations.js";
import { ruleset, STYLE_GUIDE } from "../src/ruleset.js";
import { ROOT, specText } from "./helpers.js";

const spectral = createLinter();

/** Rule codes reported for a document. */
async function codes(text: string): Promise<Set<string>> {
  return new Set((await lintText(text, "test.yaml", spectral)).map((f) => f.code));
}

/** A minimal OpenAPI 3.1 document that passes the whole ruleset, for targeted edits. */
function minimal(): Record<string, unknown> {
  const problem = { "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } };
  return {
    openapi: "3.1.0",
    info: { title: "T", version: "1", description: "d", contact: { name: "c" } },
    servers: [{ url: "https://api.example.com" }],
    tags: [{ name: "Things", description: "d" }],
    paths: {
      "/things": {
        get: {
          operationId: "listThings",
          description: "d",
          tags: ["Things"],
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["items"],
                    properties: { items: { type: "array", items: { type: "string" } }, nextCursor: { type: ["string", "null"] } },
                  },
                },
              },
            },
            "4XX": { description: "client error", content: problem },
            default: { description: "error", content: problem },
          },
        },
      },
      "/things/{thingId}": {
        get: {
          operationId: "getThing",
          description: "d",
          tags: ["Things"],
          parameters: [{ name: "thingId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "ok", content: { "application/json": { schema: { type: "string" } } } },
            "404": { description: "missing", content: problem },
          },
        },
      },
    },
    components: {
      schemas: {
        ProblemDetails: {
          type: "object",
          required: ["type", "title", "status"],
          properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" } },
        },
      },
    },
  };
}

describe("house ruleset", () => {
  test("the committed spec passes every rule with no warnings", async () => {
    const findings = await lintText(await specText(), "openapi.yaml", spectral);
    assert.deepEqual(findings, []);
  });

  test("runs Spectral's recommended OpenAPI rules plus all 13 house rules", () => {
    const houseRules = Object.keys(ruleset.rules);
    assert.deepEqual(houseRules.sort(), Object.keys(STYLE_GUIDE).sort());
    assert.equal(houseRules.length, 13);
    const loaded = Object.keys(spectral.ruleset?.rules ?? {});
    for (const code of [...houseRules, "operation-operationId", "oas3-schema", "info-contact"]) {
      assert.ok(loaded.includes(code), code);
    }
  });

  test("every house rule is documented in docs/style-guide.md under its own heading", async () => {
    const guide = await readFile(join(ROOT, "docs", "style-guide.md"), "utf8");
    for (const code of Object.keys(STYLE_GUIDE)) assert.match(guide, new RegExp(`^### ${code}$`, "m"), code);
  });

  test("a minimal compliant document passes (4XX ranges, default, nullable nextCursor)", async () => {
    assert.deepEqual([...(await codes(stringify(minimal())))], []);
  });

  test("item GETs need no pagination, collection GETs do", async () => {
    const doc = minimal() as { paths: Record<string, { get: { parameters: unknown[] } }> };
    doc.paths["/things/{thingId}"]!.get.parameters = [
      { name: "thingId", in: "path", required: true, schema: { type: "string" } },
    ];
    doc.paths["/things"]!.get.parameters = [];
    const found = await codes(stringify(doc));
    assert.ok(found.has("cfa-pagination-limit") && found.has("cfa-pagination-cursor"));
    const findings = await lintText(stringify(doc), "t.yaml", spectral);
    assert.ok(findings.every((f) => !f.path.includes("{thingId}")), "item path not flagged");
  });

  test("limit needs bounds: missing minimum, maximum 101 and a string type are each reported", async () => {
    const doc = minimal() as { paths: { "/things": { get: { parameters: { schema: Record<string, unknown> }[] } } } };
    doc.paths["/things"].get.parameters[0]!.schema = { type: "string", maximum: 101 };
    const messages = (await lintText(stringify(doc), "t.yaml", spectral))
      .filter((f) => f.code === "cfa-pagination-limit")
      .map((f) => f.message);
    assert.deepEqual(messages.sort(), [
      '"limit" must be an integer.',
      '"limit" must declare a maximum of at most 100.',
      '"limit" must declare a minimum of at least 1.',
    ]);
  });

  test("limit bounds are inclusive: minimum 0 is reported, minimum 1 and maximum 100 pass", async () => {
    const doc = minimal() as { paths: { "/things": { get: { parameters: { schema: Record<string, unknown> }[] } } } };
    const limitMessages = async (): Promise<string[]> =>
      (await lintText(stringify(doc), "t.yaml", spectral)).filter((f) => f.code === "cfa-pagination-limit").map((f) => f.message);
    doc.paths["/things"].get.parameters[0]!.schema = { type: "integer", minimum: 0, maximum: 50 };
    assert.deepEqual(await limitMessages(), ['"limit" must declare a minimum of at least 1.']);
    doc.paths["/things"].get.parameters[0]!.schema = { type: "integer", minimum: 1, maximum: 100 };
    assert.deepEqual(await limitMessages(), []);
  });

  test("a page object whose items array is not required is reported", async () => {
    const doc = minimal() as { paths: { "/things": { get: { responses: { "200": { content: Record<string, { schema: { required: string[] } }> } } } } } };
    doc.paths["/things"].get.responses["200"].content["application/json"]!.schema.required = [];
    const messages = (await lintText(stringify(doc), "t.yaml", spectral))
      .filter((f) => f.code === "cfa-pagination-envelope")
      .map((f) => f.message);
    assert.deepEqual(messages, ['The page object must have a required "items" array.']);
  });

  test("a problem schema that declares status but does not require it is reported", async () => {
    const doc = minimal() as { components: { schemas: { ProblemDetails: { required: string[] } } } };
    doc.components.schemas.ProblemDetails.required = ["type", "title"];
    const messages = (await lintText(stringify(doc), "t.yaml", spectral))
      .filter((f) => f.code === "cfa-error-problem-schema")
      .map((f) => f.message);
    assert.ok(messages.length > 0, "missing requirement reported");
    assert.ok(messages.every((m) => m.endsWith('Problem details must require "status".')), messages.join("; "));
  });

  test("an operation that documents only 5xx errors has no 4xx response", async () => {
    const doc = minimal() as { paths: { "/things/{thingId}": { get: { responses: Record<string, unknown> } } } };
    const responses = doc.paths["/things/{thingId}"].get.responses;
    responses["500"] = responses["404"];
    delete responses["404"];
    const findings = (await lintText(stringify(doc), "t.yaml", spectral)).filter((f) => f.code === "cfa-error-response-defined");
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.path, "paths./things/{thingId}.get.responses");
  });

  test("an error response with no content at all is reported", async () => {
    const doc = minimal() as { paths: { "/things": { get: { responses: Record<string, unknown> } } } };
    doc.paths["/things"].get.responses["default"] = { description: "error" };
    const findings = (await lintText(stringify(doc), "t.yaml", spectral)).filter((f) => f.code === "cfa-error-problem-json");
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.path, "paths./things.get.responses.default");
  });

  test("findings carry line, column, path and a link to the rule's documentation", async () => {
    const doc = minimal() as { paths: Record<string, unknown> };
    doc.paths["/Things_x"] = doc.paths["/things"];
    delete doc.paths["/things"];
    const text = stringify(doc);
    const finding = (await lintText(text, "t.yaml", spectral)).find((f) => f.code === "cfa-path-kebab-case");
    assert.ok(finding);
    assert.equal(finding.severity, "error");
    assert.equal(finding.message, 'Path segment "Things_x" must be lower kebab-case.');
    assert.equal(text.split("\n")[finding.line - 1]?.trim(), "/Things_x:");
    const rule = spectral.ruleset?.rules["cfa-path-kebab-case"];
    assert.match(String(rule?.documentationUrl), /docs\/style-guide\.md#cfa-path-kebab-case$/);
  });

  test("seeded violations: each of the 14 mutation kinds is caught by its rule (3 seeds each)", async () => {
    const spec = await specText();
    for (const mutation of MUTATIONS) {
      for (const seed of [1, 2, 3]) {
        const { text, change } = mutate(spec, mutation, seed);
        assert.notEqual(text, stringify(parse(spec)), `${mutation.kind} changed nothing`);
        const found = await codes(text);
        assert.ok(found.has(mutation.expected), `${mutation.kind} (seed ${seed}: ${change}) not caught; got ${[...found].join(", ")}`);
      }
    }
    const covered = new Set(MUTATIONS.map((m) => m.expected));
    assert.deepEqual([...covered].sort(), Object.keys(STYLE_GUIDE).sort(), "every house rule has a seeded violation");
  });
});
