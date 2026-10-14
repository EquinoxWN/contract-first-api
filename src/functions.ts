import { createRulesetFunction, type IFunctionResult } from "@stoplight/spectral-core";

type Json = Record<string, unknown>;
type JsonPath = (string | number)[];

/** Lower kebab-case path segment, for example `order-lines`. */
export const KEBAB_SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Lower camelCase name without consecutive capitals, for example `customerId`. */
export const CAMEL_CASE = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$/;
/** Query parameters that signal offset or page-number pagination. */
export const OFFSET_PARAMS = ["offset", "page", "pageNumber", "pageSize", "skip", "start"] as const;
/** Largest page size a list operation may allow. */
export const MAX_PAGE_LIMIT = 100;
/** Media type every error response must use (RFC 9457). */
export const PROBLEM_JSON = "application/problem+json";
/** Members every problem schema must declare and require. */
export const PROBLEM_MEMBERS = { type: "string", title: "string", status: "integer" } as const;

const PARAM_SEGMENT = /^\{([^{}]*)\}$/;
const ERROR_STATUS = /^(?:[45](?:\d\d|XX)|default)$/;
const CLIENT_ERROR = /^4(?:\d\d|XX)$/;

/** Narrow to a plain JSON object. */
function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a schema's `type` is or includes the given type. */
function hasType(schema: unknown, type: string): boolean {
  if (!isObject(schema)) return false;
  const declared = schema["type"];
  return declared === type || (Array.isArray(declared) && declared.includes(type));
}

/** Style problems in one path template such as `/orders/{orderId}`. */
export function pathProblems(path: string): string[] {
  if (!path.startsWith("/")) return [`Path "${path}" must start with "/".`];
  if (path === "/") return [];
  const problems: string[] = [];
  const segments = path.slice(1).split("/");
  if (segments.at(-1) === "") {
    problems.push(`Path "${path}" must not end with "/".`);
    segments.pop();
  }
  for (const segment of segments) {
    const param = PARAM_SEGMENT.exec(segment);
    if (segment === "") problems.push(`Path "${path}" must not contain an empty segment.`);
    else if (param) {
      if (!CAMEL_CASE.test(param[1] ?? "")) problems.push(`Path parameter "${segment}" must be camelCase.`);
    } else if (!KEBAB_SEGMENT.test(segment)) {
      problems.push(`Path segment "${segment}" must be lower kebab-case.`);
    }
  }
  return problems;
}

/** True when the path names a collection (its last segment is not a parameter). */
export function isCollectionPath(path: string): boolean {
  const last = path.split("/").at(-1) ?? "";
  return last !== "" && !PARAM_SEGMENT.test(last);
}

/** Spectral function: every path segment is kebab-case and every path parameter camelCase. */
export const pathCasing = createRulesetFunction<string, null>(
  { input: { type: "string" }, options: null },
  (path) => pathProblems(path).map((message) => ({ message })),
);

type PaginationCheck = "limit" | "cursor" | "no-offset" | "envelope";

/** Query parameters of a path item's GET operation, including those declared on the path item. */
function queryParameters(pathItem: Json, operation: Json): Map<string, Json> {
  const params = new Map<string, Json>();
  for (const list of [pathItem["parameters"], operation["parameters"]]) {
    if (!Array.isArray(list)) continue;
    for (const param of list) {
      if (isObject(param) && param["in"] === "query" && typeof param["name"] === "string") params.set(param["name"], param);
    }
  }
  return params;
}

/** Problems with the `limit` query parameter of a list operation. */
function limitProblems(params: Map<string, Json>): string[] {
  const limit = params.get("limit");
  if (!limit) return ['List operations must accept a "limit" query parameter.'];
  const schema = limit["schema"];
  const problems: string[] = [];
  if (!hasType(schema, "integer")) problems.push('"limit" must be an integer.');
  const min = isObject(schema) ? schema["minimum"] : undefined;
  const max = isObject(schema) ? schema["maximum"] : undefined;
  if (typeof min !== "number" || min < 1) problems.push('"limit" must declare a minimum of at least 1.');
  if (typeof max !== "number" || max > MAX_PAGE_LIMIT) {
    problems.push(`"limit" must declare a maximum of at most ${MAX_PAGE_LIMIT}.`);
  }
  return problems;
}

/** Problems with the JSON page envelope a list operation returns. */
function envelopeProblems(operation: Json): string[] {
  const responses = isObject(operation["responses"]) ? operation["responses"] : {};
  const ok = responses["200"];
  const content = isObject(ok) && isObject(ok["content"]) ? ok["content"] : undefined;
  const media = content?.["application/json"];
  const schema = isObject(media) ? media["schema"] : undefined;
  if (!isObject(schema)) return ['List operations must return a 200 "application/json" page object.'];
  const props = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = Array.isArray(schema["required"]) ? schema["required"] : [];
  const problems: string[] = [];
  if (!hasType(props["items"], "array") || !required.includes("items")) {
    problems.push('The page object must have a required "items" array.');
  }
  if (!hasType(props["nextCursor"], "string")) problems.push('The page object must have a "nextCursor" string.');
  return problems;
}

/** Spectral function on a path item: a collection GET uses cursor pagination with a bounded limit. */
export const listPagination = createRulesetFunction<Json, { check: PaginationCheck }>(
  {
    input: { type: "object" },
    options: {
      type: "object",
      properties: { check: { enum: ["limit", "cursor", "no-offset", "envelope"] } },
      required: ["check"],
      additionalProperties: false,
    },
  },
  (pathItem, { check }, context) => {
    const pathKey = context.path.at(-1);
    const operation = pathItem["get"];
    if (typeof pathKey !== "string" || !isCollectionPath(pathKey) || !isObject(operation)) return [];
    const params = queryParameters(pathItem, operation);
    let problems: string[];
    switch (check) {
      case "limit":
        problems = limitProblems(params);
        break;
      case "cursor":
        problems = hasType(params.get("cursor")?.["schema"], "string")
          ? []
          : ['List operations must accept a "cursor" string query parameter.'];
        break;
      case "no-offset":
        problems = OFFSET_PARAMS.filter((name) => params.has(name)).map(
          (name) => `Use cursor pagination: remove the "${name}" query parameter.`,
        );
        break;
      case "envelope":
        problems = envelopeProblems(operation);
        break;
    }
    return problems.map((message) => ({ message, path: [...context.path, "get"] }));
  },
);

type ErrorCheck = "defined" | "media-type" | "schema";

/** Problems with the problem-details schema of one error response. */
function problemSchemaProblems(schema: unknown): string[] {
  if (!isObject(schema)) return ["Error responses must declare a problem-details schema."];
  const props = isObject(schema["properties"]) ? schema["properties"] : {};
  const required = Array.isArray(schema["required"]) ? schema["required"] : [];
  const problems: string[] = [];
  for (const [member, type] of Object.entries(PROBLEM_MEMBERS)) {
    if (!hasType(props[member], type)) problems.push(`Problem details must have a "${member}" ${type}.`);
    else if (!required.includes(member)) problems.push(`Problem details must require "${member}".`);
  }
  return problems;
}

/** Spectral function: errors are documented and use RFC 9457 problem details. */
export const errorFormat = createRulesetFunction<Json, { check: ErrorCheck }>(
  {
    input: { type: "object" },
    options: {
      type: "object",
      properties: { check: { enum: ["defined", "media-type", "schema"] } },
      required: ["check"],
      additionalProperties: false,
    },
  },
  (responses, { check }, context) => {
    const results: IFunctionResult[] = [];
    if (check === "defined") {
      if (!Object.keys(responses).some((code) => CLIENT_ERROR.test(code))) {
        results.push({ message: "Operations must document at least one 4xx error response." });
      }
      return results;
    }
    for (const [code, response] of Object.entries(responses)) {
      if (!ERROR_STATUS.test(code) || !isObject(response)) continue;
      const content = isObject(response["content"]) ? response["content"] : undefined;
      const at: JsonPath = [...context.path, code, ...(content ? ["content"] : [])];
      if (check === "media-type") {
        const types = content ? Object.keys(content) : [];
        if (types.length !== 1 || types[0] !== PROBLEM_JSON) {
          results.push({ message: `Error response ${code} must use only "${PROBLEM_JSON}".`, path: at });
        }
        continue;
      }
      const media = content?.[PROBLEM_JSON];
      if (!isObject(media)) continue;
      for (const message of problemSchemaProblems(media["schema"])) {
        results.push({
          message: `Error response ${code}: ${message}`,
          path: [...context.path, code, "content", PROBLEM_JSON, "schema"],
        });
      }
    }
    return results;
  },
);
