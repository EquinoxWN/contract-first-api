# ADR 0002: Commit the generated OpenAPI document and fail CI when it drifts

- **Status:** Accepted

## Context

TypeSpec is the source of truth, and `openapi/openapi.yaml` is generated from it. A generated
file can either be built only in CI (never committed) or committed next to its source.

Not committing it keeps one source of truth, but reviewers then never see the contract a change
produces: a one-line TypeSpec edit (a template parameter, an emitter option, a TypeSpec upgrade)
can change dozens of lines of OpenAPI, and those are the lines clients depend on. The breaking-
change check planned for M2 also needs the last released document as a file to diff against.

Committing it creates a second copy that can drift: someone edits the YAML by hand or forgets to
regenerate.

## Decision

Commit `openapi/openapi.yaml`, and make drift impossible to merge. `contract check` compiles the
TypeSpec in memory (a compiler host whose `writeFile` captures output instead of writing it),
compares the result byte for byte (line endings normalised) with the committed file, and fails
with `out of date with spec/` if they differ. `make ci` runs it on every push and pull request.
The emitter writes LF line endings and `.gitattributes` pins LF, so the comparison is the same on
Windows and Linux.

## Consequences

- Every pull request shows the OpenAPI diff next to the TypeSpec diff, so reviewers judge the
  contract, not only its source. TypeSpec upgrades that change the output show up as a diff.
- A hand edit to the YAML, or a TypeSpec edit without `make spec`, fails CI (tested in `test/compile.test.ts` and, end to end, in
  `test/e2e.test.ts`).
- The repository carries a generated file (519 lines today), and contributors must run
  `make spec` after editing `spec/`. The error message says so.
