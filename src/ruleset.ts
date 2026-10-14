import type { RulesetDefinition } from "@stoplight/spectral-core";
import { oas3 } from "@stoplight/spectral-formats";
import { pattern } from "@stoplight/spectral-functions";
import { oas } from "@stoplight/spectral-rulesets";
import { CAMEL_CASE, errorFormat, listPagination, pathCasing } from "./functions.js";

/** Where each rule is explained. */
const DOCS = "https://github.com/EquinoxWN/contract-first-api/blob/main/docs/style-guide.md";
/** Every operation object under `paths`. */
const OPERATIONS = "$.paths[*][get,put,post,patch,delete,head,options,trace]";

export type Category = "version" | "naming" | "pagination" | "errors";

/** The house style guide: rule code to category and one-line summary. */
export const STYLE_GUIDE: Readonly<Record<string, { category: Category; summary: string }>> = {
  "cfa-openapi-3-1": { category: "version", summary: "The document is OpenAPI 3.1." },
  "cfa-path-kebab-case": { category: "naming", summary: "Path segments are lower kebab-case; path parameters are camelCase." },
  "cfa-operation-id-camel-case": { category: "naming", summary: "operationId is camelCase." },
  "cfa-schema-pascal-case": { category: "naming", summary: "Component schema names are PascalCase." },
  "cfa-property-camel-case": { category: "naming", summary: "Schema property names are camelCase." },
  "cfa-query-parameter-camel-case": { category: "naming", summary: "Query parameter names are camelCase." },
  "cfa-pagination-limit": { category: "pagination", summary: "List operations accept an integer `limit` with minimum >= 1 and maximum <= 100." },
  "cfa-pagination-cursor": { category: "pagination", summary: "List operations accept a string `cursor`." },
  "cfa-pagination-no-offset": { category: "pagination", summary: "List operations do not use offset or page-number parameters." },
  "cfa-pagination-envelope": { category: "pagination", summary: "List operations return `{ items: [...], nextCursor }`." },
  "cfa-error-response-defined": { category: "errors", summary: "Every operation documents at least one 4xx response." },
  "cfa-error-problem-json": { category: "errors", summary: "4xx, 5xx and default responses use only `application/problem+json`." },
  "cfa-error-problem-schema": { category: "errors", summary: "Problem details declare and require `type`, `title` and `status` (RFC 9457)." },
};

/** Common fields for one house rule. */
function rule(code: string): { description: string; documentationUrl: string; severity: "error"; message: string } {
  const entry = STYLE_GUIDE[code];
  if (!entry) throw new Error(`unknown style rule ${code}`);
  return { description: entry.summary, documentationUrl: `${DOCS}#${code}`, severity: "error", message: "{{error}}" };
}

/** Spectral's recommended OpenAPI rules plus the house style guide. */
export const ruleset = {
  extends: [[oas as RulesetDefinition, "recommended"]],
  formats: [oas3],
  rules: {
    "cfa-openapi-3-1": {
      ...rule("cfa-openapi-3-1"),
      message: 'The document must be OpenAPI 3.1 (found "{{value}}").',
      given: "$",
      then: { field: "openapi", function: pattern, functionOptions: { match: "^3\\.1\\.\\d+$" } },
    },
    "cfa-path-kebab-case": {
      ...rule("cfa-path-kebab-case"),
      given: "$.paths",
      then: { field: "@key", function: pathCasing },
    },
    "cfa-operation-id-camel-case": {
      ...rule("cfa-operation-id-camel-case"),
      message: 'operationId "{{value}}" must be camelCase.',
      given: OPERATIONS,
      then: { field: "operationId", function: pattern, functionOptions: { match: CAMEL_CASE.source } },
    },
    "cfa-schema-pascal-case": {
      ...rule("cfa-schema-pascal-case"),
      message: 'Schema name "{{property}}" must be PascalCase.',
      given: "$.components.schemas",
      resolved: false,
      then: { field: "@key", function: pattern, functionOptions: { match: "^[A-Z][a-zA-Z0-9]*$" } },
    },
    "cfa-property-camel-case": {
      ...rule("cfa-property-camel-case"),
      message: 'Property name "{{property}}" must be camelCase.',
      given: "$..properties",
      resolved: false,
      then: { field: "@key", function: pattern, functionOptions: { match: CAMEL_CASE.source } },
    },
    "cfa-query-parameter-camel-case": {
      ...rule("cfa-query-parameter-camel-case"),
      message: 'Query parameter "{{value}}" must be camelCase.',
      given: "$..parameters[?(@ && @.in == 'query')]",
      resolved: false,
      then: { field: "name", function: pattern, functionOptions: { match: CAMEL_CASE.source } },
    },
    "cfa-pagination-limit": {
      ...rule("cfa-pagination-limit"),
      given: "$.paths[*]",
      then: { function: listPagination, functionOptions: { check: "limit" } },
    },
    "cfa-pagination-cursor": {
      ...rule("cfa-pagination-cursor"),
      given: "$.paths[*]",
      then: { function: listPagination, functionOptions: { check: "cursor" } },
    },
    "cfa-pagination-no-offset": {
      ...rule("cfa-pagination-no-offset"),
      given: "$.paths[*]",
      then: { function: listPagination, functionOptions: { check: "no-offset" } },
    },
    "cfa-pagination-envelope": {
      ...rule("cfa-pagination-envelope"),
      given: "$.paths[*]",
      then: { function: listPagination, functionOptions: { check: "envelope" } },
    },
    "cfa-error-response-defined": {
      ...rule("cfa-error-response-defined"),
      given: `${OPERATIONS}.responses`,
      then: { function: errorFormat, functionOptions: { check: "defined" } },
    },
    "cfa-error-problem-json": {
      ...rule("cfa-error-problem-json"),
      given: `${OPERATIONS}.responses`,
      then: { function: errorFormat, functionOptions: { check: "media-type" } },
    },
    "cfa-error-problem-schema": {
      ...rule("cfa-error-problem-schema"),
      given: `${OPERATIONS}.responses`,
      then: { function: errorFormat, functionOptions: { check: "schema" } },
    },
  },
} satisfies RulesetDefinition;
