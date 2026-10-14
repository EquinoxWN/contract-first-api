import { parse, stringify } from "yaml";

type Json = Record<string, unknown>;

/** One way to break the style guide, and the rule that must catch it. */
export interface Mutation {
  kind: string;
  expected: string;
  /** Change the document in place; returns a short description of what changed. */
  apply: (doc: Json, rand: () => number) => string;
}

/** Deterministic pseudo-random numbers in [0, 1) from a 32-bit seed (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Narrow to a plain object or fail loudly (the input is our own generated spec). */
function obj(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as Json;
}

/** Pick one element at random. */
function pick<T>(items: readonly T[], rand: () => number): T {
  if (items.length === 0) throw new Error("nothing to pick from");
  return items[Math.floor(rand() * items.length)] as T;
}

/** camelCase or PascalCase to snake_case, guaranteed to contain an underscore. */
export function toSnake(name: string): string {
  const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "");
  return snake.includes("_") ? snake : `${snake}_value`;
}

/** All (schema name, property name) pairs in components.schemas. */
function properties(doc: Json): [string, string][] {
  const schemas = obj(obj(doc["components"], "components")["schemas"], "schemas");
  return Object.entries(schemas).flatMap(([name, schema]) =>
    Object.keys(obj(obj(schema, name)["properties"] ?? {}, `${name}.properties`)).map((p): [string, string] => [name, p]),
  );
}

/** Paths whose last segment is not a parameter and that have a GET. */
function listPaths(doc: Json): string[] {
  const paths = obj(doc["paths"], "paths");
  return Object.keys(paths).filter((p) => !p.endsWith("}") && obj(paths[p], p)["get"] !== undefined);
}

/** Every operation object with its path and method. */
function operations(doc: Json): { path: string; method: string; op: Json }[] {
  const paths = obj(doc["paths"], "paths");
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(obj(item, path))
      .filter(([method]) => ["get", "put", "post", "patch", "delete"].includes(method))
      .map(([method, op]) => ({ path, method, op: obj(op, `${path}.${method}`) })),
  );
}

/** Replace every `$ref` string equal to `from` with `to`. */
function rewriteRefs(node: unknown, from: string, to: string): void {
  if (Array.isArray(node)) node.forEach((n) => rewriteRefs(n, from, to));
  else if (typeof node === "object" && node !== null) {
    const o = node as Json;
    for (const [k, v] of Object.entries(o)) {
      if (k === "$ref" && v === from) o[k] = to;
      else rewriteRefs(v, from, to);
    }
  }
}

/** Parameter list of the GET operation on a path, with $refs left as they are. */
function getParams(doc: Json, path: string): unknown[] {
  const op = obj(obj(obj(doc["paths"], "paths")[path], path)["get"], `${path}.get`);
  if (!Array.isArray(op["parameters"])) op["parameters"] = [];
  return op["parameters"] as unknown[];
}

/** Remove the named parameter from a list, failing if it is not there. */
function removeParam(params: unknown[], name: string): void {
  const index = params.findIndex((p) => isParam(p, name));
  if (index < 0) throw new Error(`no ${name} parameter to remove`);
  params.splice(index, 1);
}

/** True when a parameter (inline or $ref) has the given name. */
function isParam(param: unknown, name: string): boolean {
  const p = obj(param, "parameter");
  return p["name"] === name || (typeof p["$ref"] === "string" && p["$ref"].endsWith(`.${name}`));
}

/** The seeded style-guide violations, one per house rule. */
export const MUTATIONS: readonly Mutation[] = [
  {
    kind: "OpenAPI 3.0 instead of 3.1",
    expected: "cfa-openapi-3-1",
    apply: (doc, rand) => {
      doc["openapi"] = pick(["3.0.3", "3.0.0", "3.2.0"], rand);
      return `openapi: ${String(doc["openapi"])}`;
    },
  },
  {
    kind: "path segment not kebab-case",
    expected: "cfa-path-kebab-case",
    apply: (doc, rand) => {
      const paths = obj(doc["paths"], "paths");
      const old = pick(Object.keys(paths), rand);
      const segments = old.split("/");
      const index = pick(segments.map((s, i) => (s && !s.startsWith("{") ? i : -1)).filter((i) => i >= 0), rand);
      const seg = segments[index] ?? "";
      segments[index] = pick([seg.toUpperCase(), `${seg}_list`, `${seg[0]?.toUpperCase()}${seg.slice(1)}`], rand);
      const renamed = segments.join("/");
      paths[renamed] = paths[old];
      delete paths[old];
      return `${old} -> ${renamed}`;
    },
  },
  {
    kind: "operationId not camelCase",
    expected: "cfa-operation-id-camel-case",
    apply: (doc, rand) => {
      const { op } = pick(operations(doc), rand);
      const id = String(op["operationId"]);
      op["operationId"] = pick([toSnake(id), `${id[0]?.toUpperCase()}${id.slice(1)}`, `Orders_${id}`], rand);
      return `${id} -> ${String(op["operationId"])}`;
    },
  },
  {
    kind: "schema name not PascalCase",
    expected: "cfa-schema-pascal-case",
    apply: (doc, rand) => {
      const schemas = obj(obj(doc["components"], "components")["schemas"], "schemas");
      const old = pick(Object.keys(schemas), rand);
      const renamed = pick([toSnake(old), `${old[0]?.toLowerCase()}${old.slice(1)}`], rand);
      schemas[renamed] = schemas[old];
      delete schemas[old];
      rewriteRefs(doc, `#/components/schemas/${old}`, `#/components/schemas/${renamed}`);
      return `${old} -> ${renamed}`;
    },
  },
  {
    kind: "property not camelCase",
    expected: "cfa-property-camel-case",
    apply: (doc, rand) => {
      const [schema, prop] = pick(properties(doc), rand);
      const props = obj(obj(obj(obj(doc["components"], "c")["schemas"], "s")[schema], schema)["properties"], "p");
      const renamed = pick([toSnake(prop), `${prop[0]?.toUpperCase()}${prop.slice(1)}`, `${prop}-x`], rand);
      props[renamed] = props[prop];
      delete props[prop];
      return `${schema}.${prop} -> ${renamed}`;
    },
  },
  {
    kind: "query parameter not camelCase",
    expected: "cfa-query-parameter-camel-case",
    apply: (doc, rand) => {
      const path = pick(listPaths(doc), rand);
      const name = pick(["sort_by", "Filter", "created-after"], rand);
      getParams(doc, path).push({ name, in: "query", required: false, schema: { type: "string" } });
      return `${path}: added query parameter ${name}`;
    },
  },
  {
    kind: "list without limit",
    expected: "cfa-pagination-limit",
    apply: (doc, rand) => {
      const path = pick(listPaths(doc), rand);
      const params = getParams(doc, path);
      removeParam(params, "limit");
      return `${path}: removed limit`;
    },
  },
  {
    kind: "limit above 100",
    expected: "cfa-pagination-limit",
    apply: (doc, rand) => {
      const params = obj(obj(doc["components"], "components")["parameters"], "parameters");
      const key = Object.keys(params).find((k) => k.endsWith(".limit")) ?? "";
      const schema = obj(obj(params[key], key)["schema"], "schema");
      schema["maximum"] = 101 + Math.floor(rand() * 900);
      return `limit maximum ${String(schema["maximum"])}`;
    },
  },
  {
    kind: "list without cursor",
    expected: "cfa-pagination-cursor",
    apply: (doc, rand) => {
      const path = pick(listPaths(doc), rand);
      const params = getParams(doc, path);
      removeParam(params, "cursor");
      return `${path}: removed cursor`;
    },
  },
  {
    kind: "offset pagination",
    expected: "cfa-pagination-no-offset",
    apply: (doc, rand) => {
      const path = pick(listPaths(doc), rand);
      const name = pick(["offset", "page", "skip"], rand);
      getParams(doc, path).push({ name, in: "query", required: false, schema: { type: "integer", minimum: 0 } });
      return `${path}: added ${name}`;
    },
  },
  {
    kind: "page without nextCursor",
    expected: "cfa-pagination-envelope",
    apply: (doc, rand) => {
      const schemas = obj(obj(doc["components"], "components")["schemas"], "schemas");
      const page = pick(Object.keys(schemas).filter((k) => k.endsWith("Page")), rand);
      const props = obj(obj(schemas[page], page)["properties"], "properties");
      const field = pick(["nextCursor", "items"], rand);
      delete props[field];
      return `${page}: removed ${field}`;
    },
  },
  {
    kind: "operation without 4xx",
    expected: "cfa-error-response-defined",
    apply: (doc, rand) => {
      const { path, method, op } = pick(operations(doc), rand);
      const responses = obj(op["responses"], "responses");
      for (const code of Object.keys(responses)) if (code.startsWith("4")) delete responses[code];
      return `${method.toUpperCase()} ${path}: removed 4xx responses`;
    },
  },
  {
    kind: "error as application/json",
    expected: "cfa-error-problem-json",
    apply: (doc, rand) => {
      const { path, method, op } = pick(operations(doc), rand);
      const responses = obj(op["responses"], "responses");
      const code = pick(Object.keys(responses).filter((c) => /^[45]/.test(c)), rand);
      const response = obj(responses[code], code);
      const content = obj(response["content"], "content");
      content["application/json"] = content["application/problem+json"];
      if (rand() < 0.5) delete content["application/problem+json"];
      return `${method.toUpperCase()} ${path} ${code}: application/json`;
    },
  },
  {
    kind: "problem details missing a member",
    expected: "cfa-error-problem-schema",
    apply: (doc, rand) => {
      const schemas = obj(obj(doc["components"], "components")["schemas"], "schemas");
      const problem = obj(schemas["ProblemDetails"], "ProblemDetails");
      const member = pick(["type", "title", "status"], rand);
      if (rand() < 0.5) delete obj(problem["properties"], "properties")[member];
      problem["required"] = (problem["required"] as string[]).filter((m) => m !== member);
      return `ProblemDetails: dropped ${member}`;
    },
  },
];

/** Apply one mutation to a fresh copy of the spec text and return the mutated YAML. */
export function mutate(specText: string, mutation: Mutation, seed: number): { text: string; change: string } {
  const doc = obj(parse(specText), "spec");
  const change = mutation.apply(doc, seededRandom(seed));
  return { text: stringify(doc, { aliasDuplicateObjects: false }), change };
}
