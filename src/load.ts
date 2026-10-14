import { open } from "node:fs/promises";
import { parseAllDocuments } from "yaml";

/** Largest spec file the linter reads (5 MiB). */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
/** Most YAML aliases a spec may use, which blocks alias-expansion ("billion laughs") attacks. */
export const MAX_ALIASES = 100;

/** A spec file that cannot be linted, with a message safe to show the user. */
export class SpecError extends Error {
  override readonly name = "SpecError";
}

/** Decode UTF-8 strictly and drop a leading byte-order mark. */
function decodeUtf8(bytes: Uint8Array, source: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new SpecError(`${source}: not valid UTF-8`);
  }
}

/** Check that text is one bounded YAML or JSON document whose root is an OpenAPI object. */
export function validateSpecText(text: string, source: string): void {
  if (Buffer.byteLength(text, "utf8") > MAX_SPEC_BYTES) {
    throw new SpecError(`${source}: larger than ${MAX_SPEC_BYTES} bytes`);
  }
  const docs = parseAllDocuments(text, { uniqueKeys: true, prettyErrors: true });
  if (docs.length !== 1) throw new SpecError(`${source}: expected exactly one YAML document, found ${docs.length}`);
  const doc = docs[0]!;
  const problem = doc.errors[0];
  if (problem) throw new SpecError(`${source}: ${problem.message.split("\n")[0]}`);
  let root: unknown;
  try {
    root = doc.toJS({ maxAliasCount: MAX_ALIASES });
  } catch (error) {
    throw new SpecError(`${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new SpecError(`${source}: the root must be a mapping`);
  }
  if (typeof (root as Record<string, unknown>)["openapi"] !== "string") {
    throw new SpecError(`${source}: missing the "openapi" version field`);
  }
}

/** Read a spec file: regular file only, size-capped, strict UTF-8, validated shape. */
export async function readSpec(file: string): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "error";
    throw new SpecError(`${file}: cannot open (${code})`);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new SpecError(`${file}: not a regular file`);
    if (stat.size > MAX_SPEC_BYTES) throw new SpecError(`${file}: larger than ${MAX_SPEC_BYTES} bytes`);
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
    const text = decodeUtf8(buffer.subarray(0, bytesRead), file);
    validateSpecText(text, file);
    return text;
  } finally {
    await handle.close();
  }
}
