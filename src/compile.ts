import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { compile, formatDiagnostic, NodeHost, resolveCompilerOptions, type CompilerHost } from "@typespec/compiler";

/** Where the TypeSpec entry point and config live, relative to the project root. */
export const ENTRYPOINT = "spec/main.tsp";
export const CONFIG = "tspconfig.yaml";

/** Result of compiling the TypeSpec project in memory. */
export interface CompileResult {
  /** Emitted files: path relative to the project root (forward slashes) to content. */
  files: Map<string, string>;
  /** Formatted compiler diagnostics; warnings count, because the config sets warn-as-error. */
  diagnostics: string[];
}

/** Path relative to root with forward slashes, refusing anything outside root. */
export function insideRoot(root: string, file: string): string {
  const rel = relative(resolve(root), resolve(root, file));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${file} is outside ${root}`);
  return rel.split("\\").join("/");
}

/** Compile spec/main.tsp with tspconfig.yaml, capturing emitted files instead of writing them. */
export async function compileSpec(root: string): Promise<CompileResult> {
  const projectRoot = resolve(root);
  const entrypoint = resolve(projectRoot, ENTRYPOINT);
  const [options, configDiagnostics] = await resolveCompilerOptions(NodeHost, {
    cwd: projectRoot,
    entrypoint,
    configPath: resolve(projectRoot, CONFIG),
  });
  const files = new Map<string, string>();
  const host: CompilerHost = {
    ...NodeHost,
    writeFile: async (path, content) => {
      files.set(insideRoot(projectRoot, path), content);
    },
    mkdirp: async (path) => path,
  };
  const program = await compile(host, entrypoint, options);
  const diagnostics = [...configDiagnostics, ...program.diagnostics].map((d) => formatDiagnostic(d));
  return { files, diagnostics };
}

/** Write emitted files under root, creating folders as needed. */
export async function writeEmitted(root: string, files: Map<string, string>): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, content] of files) {
    const target = resolve(root, insideRoot(root, rel));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    written.push(rel);
  }
  return written;
}

/** Emitted files whose committed copy is missing or different. */
export async function staleFiles(root: string, files: Map<string, string>): Promise<string[]> {
  const stale: string[] = [];
  for (const [rel, content] of files) {
    const committed = await readFile(resolve(root, insideRoot(root, rel)), "utf8").catch(() => undefined);
    if (committed?.replaceAll("\r\n", "\n") !== content.replaceAll("\r\n", "\n")) stale.push(rel);
  }
  return stale;
}
