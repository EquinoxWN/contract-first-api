import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import { ROOT, scratch, specText } from "./helpers.js";

const run = promisify(execFile);
const CLI = join(ROOT, "dist", "src", "cli.js");

/** Run the built CLI in a folder and return its exit code and output. */
async function cli(cwd: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("end to end: TypeSpec edit -> compile -> lint, as separate processes", () => {
  test("build, check, a style break, a stale file, and the fix", async () => {
    const { dir, cleanup } = await scratch("e2e");
    try {
      await cp(join(ROOT, "spec"), join(dir, "spec"), { recursive: true });
      await cp(join(ROOT, "tspconfig.yaml"), join(dir, "tspconfig.yaml"));

      // 1. A fresh build writes the same OpenAPI document as the committed one and lints clean.
      const build = await cli(dir, "build");
      assert.equal(build.code, 0, build.stderr + build.stdout);
      assert.match(build.stderr, /wrote openapi\/openapi\.yaml/);
      assert.match(build.stdout, /0 errors, 0 warnings/);
      assert.equal(await readFile(join(dir, "openapi", "openapi.yaml"), "utf8"), (await specText()).replaceAll("\r\n", "\n"));

      // 2. check passes and prints a GitHub notice.
      const check = await cli(dir, "check", "--format", "github");
      assert.equal(check.code, 0, check.stderr);
      assert.match(check.stdout, /^::notice title=contract lint::openapi\/openapi\.yaml: 70 rules, 0 errors/m);

      // 3. Edit the TypeSpec: a snake_case property and an offset parameter.
      const main = join(dir, "spec", "main.tsp");
      const original = await readFile(main, "utf8");
      const broken = original
        .replace("displayName: string;", "display_name: string;")
        .replace("list(...PageParameters): Page<Customer>", "list(...PageParameters, @query offset?: int32): Page<Customer>");
      assert.notEqual(broken, original);
      await writeFile(main, broken);

      // 4. check now fails because the committed file no longer matches the spec.
      const stale = await cli(dir, "check");
      assert.equal(stale.code, 1);
      assert.match(stale.stderr, /out of date with spec\/: openapi\/openapi\.yaml/);

      // 5. build regenerates it, and the style guide blocks both changes.
      const blocked = await cli(dir, "build");
      assert.equal(blocked.code, 1);
      assert.match(blocked.stdout, /cfa-property-camel-case {2}Property name "display_name" must be camelCase/);
      assert.match(blocked.stdout, /cfa-pagination-no-offset {2}Use cursor pagination: remove the "offset" query parameter/);

      // 6. Reverting the TypeSpec and rebuilding brings everything back to green.
      await writeFile(main, original);
      assert.equal((await cli(dir, "build")).code, 0);
      assert.equal((await cli(dir, "check")).code, 0);
    } finally {
      await cleanup();
    }
  });

  test("a TypeSpec compile error fails build with the compiler's message", async () => {
    const { dir, cleanup } = await scratch("e2e");
    try {
      await cp(join(ROOT, "spec"), join(dir, "spec"), { recursive: true });
      await cp(join(ROOT, "tspconfig.yaml"), join(dir, "tspconfig.yaml"));
      const main = join(dir, "spec", "main.tsp");
      await writeFile(main, (await readFile(main, "utf8")).replace("customerId: ResourceId;", "customerId: NoSuchType;"));
      const result = await cli(dir, "build");
      assert.equal(result.code, 1);
      assert.match(result.stderr, /NoSuchType/);
      assert.match(result.stderr, /TypeSpec compile failed/);
    } finally {
      await cleanup();
    }
  });
});
