import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { parse } from "yaml";
import { compileSpec, insideRoot, staleFiles } from "../src/compile.js";
import { CAMEL_CASE } from "../src/functions.js";
import { createLinter, lintText } from "../src/lint.js";
import { STYLE_GUIDE } from "../src/ruleset.js";
import { ROOT, specText } from "./helpers.js";

type Doc = { openapi: string; paths: Record<string, Record<string, { operationId?: string }>> };

describe("TypeSpec to OpenAPI 3.1", () => {
  test("spec/main.tsp compiles with no diagnostics (warnings are errors) to one OpenAPI 3.1 file", async () => {
    const { files, diagnostics } = await compileSpec(ROOT);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual([...files.keys()], ["openapi/openapi.yaml"]);
    const doc = parse(files.get("openapi/openapi.yaml") ?? "") as Doc;
    assert.equal(doc.openapi, "3.1.0");
  });

  test("the committed openapi/openapi.yaml is exactly what the TypeSpec compiles to", async () => {
    const { files } = await compileSpec(ROOT);
    assert.deepEqual(await staleFiles(ROOT, files), []);
    assert.equal(files.get("openapi/openapi.yaml"), (await specText()).replaceAll("\r\n", "\n"));
  });

  test("a changed or missing emitted file is reported as stale", async () => {
    const { files } = await compileSpec(ROOT);
    const changed = new Map(files);
    changed.set("openapi/openapi.yaml", `${files.get("openapi/openapi.yaml") ?? ""}# edited\n`);
    changed.set("openapi/extra.yaml", "openapi: 3.1.0\n");
    assert.deepEqual(await staleFiles(ROOT, changed), ["openapi/openapi.yaml", "openapi/extra.yaml"]);
  });

  test("every operation has an explicit camelCase operationId and the expected routes", async () => {
    const doc = parse(await specText()) as Doc;
    const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, op]) => `${method.toUpperCase()} ${path} ${op.operationId ?? "-"}`),
    );
    assert.deepEqual(ops.sort(), [
      "GET /customers listCustomers",
      "GET /customers/{customerId} getCustomer",
      "GET /customers/{customerId}/orders listCustomerOrders",
      "GET /orders listOrders",
      "GET /orders/{orderId} getOrder",
      "POST /customers createCustomer",
      "POST /orders createOrder",
      "POST /orders/{orderId}/cancellation cancelOrder",
    ]);
    for (const op of ops) assert.ok(CAMEL_CASE.test(op.split(" ")[2] ?? ""), op);
  });

  test("baseline: the first draft (TypeSpec defaults) fails naming, pagination and error rules", async () => {
    const { files, diagnostics } = await compileSpec(join(ROOT, "test", "fixtures", "draft"));
    assert.deepEqual(diagnostics, []);
    const text = [...files.values()][0] ?? "";
    const findings = await lintText(text, "draft.yaml", createLinter());
    const areas = new Set(findings.map((f) => STYLE_GUIDE[f.code]?.category).filter(Boolean));
    assert.deepEqual([...areas].sort(), ["errors", "naming", "pagination"]);
    const errors = findings.filter((f) => f.severity === "error");
    assert.equal(errors.length, 46);
    assert.ok(findings.some((f) => f.code === "cfa-operation-id-camel-case" && f.message.includes("Orders_list")));
    assert.ok(findings.some((f) => f.code === "cfa-property-camel-case" && f.message.includes("created_at")));
    assert.ok(findings.some((f) => f.code === "cfa-pagination-no-offset" && f.message.includes('"offset"')));
  });

  test("emitted paths must stay inside the project root", () => {
    assert.equal(insideRoot(ROOT, join(ROOT, "openapi", "openapi.yaml")), "openapi/openapi.yaml");
    for (const outside of ["..", "../x.yaml", join(ROOT, "..", "elsewhere.yaml"), ROOT]) {
      assert.throws(() => insideRoot(ROOT, outside), /outside/, outside);
    }
  });
});
