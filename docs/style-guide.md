# API style guide

Every rule below is enforced by `contract lint` (Spectral with the ruleset in
[`src/ruleset.ts`](../src/ruleset.ts)) on the OpenAPI document generated from `spec/`. All house
rules are errors. On top of them the linter runs Spectral's recommended OpenAPI ruleset
(`spectral:oas`, 57 rules), whose warnings also fail the build by default (`--fail-on warn`).

The TypeSpec building blocks in [`spec/lib/style.tsp`](../spec/lib/style.tsp) (`PageParameters`,
`Page<T>`, `ProblemDetails`, `BadRequest`, `NotFound`...) make a new operation follow the
pagination and error rules by construction. The linter checks the output anyway, so a
hand-written exception or a change in the TypeSpec emitter cannot slip through.

Each rule's `documentationUrl` points to its heading here, so a finding links to its explanation.

## Version

### cfa-openapi-3-1

The document is OpenAPI 3.1 (`openapi: 3.1.x`). 3.1 aligns schemas with JSON Schema 2020-12
(for example `type: [string, "null"]` instead of `nullable`), which the generators planned for
M2 rely on.

## Naming

### cfa-path-kebab-case

Path segments are lower kebab-case (`/order-lines`), path parameters are camelCase
(`/orders/{orderId}`). No trailing slash and no empty segment (`//`).

### cfa-operation-id-camel-case

`operationId` is camelCase: verb then noun (`listOrders`, `getCustomer`, `cancelOrder`). SDK
generators turn it into method names. `tspconfig.yaml` sets `operation-id-strategy:
explicit-only`, so every TypeSpec operation must name its id with `@operationId`; the TypeSpec
default (`Orders_list`) breaks this rule.

### cfa-schema-pascal-case

Component schema names are PascalCase (`OrderLine`, `ProblemDetails`). This also catches
TypeSpec's dotted names for types declared outside the service namespace
(`ContractFirst.Style.ProblemDetails`); give such types a `@friendlyName`.

### cfa-property-camel-case

Schema property names are camelCase (`createdAt`, `amountMinor`), never `snake_case`,
`kebab-case` or PascalCase. Consecutive capitals are not allowed (`customerId`, not `customerID`).

### cfa-query-parameter-camel-case

Query parameter names are camelCase (`limit`, `cursor`, `status`). Header names keep their HTTP
spelling (`Idempotency-Key`) and are not checked.

## Pagination

A list operation is a `GET` on a path whose last segment is not a parameter (`/orders`,
`/customers/{customerId}/orders`). Lists use opaque cursors, never offsets, so pages stay stable
while rows are inserted and the server can change its storage without breaking clients.

### cfa-pagination-limit

List operations accept a `limit` query parameter of type integer, with `minimum` of at least 1
and `maximum` of at most 100. An unbounded page size is a denial-of-service risk.

### cfa-pagination-cursor

List operations accept a `cursor` query parameter of type string: the `nextCursor` of the
previous page.

### cfa-pagination-no-offset

List operations do not accept `offset`, `page`, `pageNumber`, `pageSize`, `skip` or `start`.

### cfa-pagination-envelope

List operations return `200` with an `application/json` object that has a required `items`
array and a `nextCursor` string (it may be optional or nullable; absent means last page).

## Error format

Errors use problem details ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)), so every client
can parse every error the same way.

### cfa-error-response-defined

Every operation documents at least one 4xx response (`400`, `404`, `409`... or the `4XX` range).

### cfa-error-problem-json

Every `4xx`, `5xx`, `4XX`, `5XX` and `default` response has content, and its only media type is
`application/problem+json`.

### cfa-error-problem-schema

The problem-details schema declares `type` (string), `title` (string) and `status` (integer) and
lists all three in `required`. `detail` and `instance` are optional.
