# ADR 0003: Write the Spectral ruleset in TypeScript and run Spectral as a library

- **Status:** Accepted

## Context

Spectral rulesets are usually a `.spectral.yaml` file run by `@stoplight/spectral-cli`, with
custom functions as separate JavaScript files. The house style needs custom logic that the
built-in functions cannot express: kebab-case path segments with camelCase parameters, "a `GET`
on a collection path must accept `limit` and `cursor`", and "every error response uses only
`application/problem+json` with a valid problem schema".

Two further needs: the linter must not follow external `$ref`s (a spec from a pull request should
not make CI fetch URLs or read local files), and its input must be bounded before parsing.

## Decision

Define the ruleset as a TypeScript object (`src/ruleset.ts`, checked with `satisfies
RulesetDefinition`) that extends Spectral's recommended OpenAPI rules, with custom functions
written in strict TypeScript (`src/functions.ts`) and their option schemas validated by
`createRulesetFunction`. Run Spectral through `@stoplight/spectral-core` from the project's own
CLI, with a `$ref` resolver that has no readers, after `src/load.ts` has bounded and validated the
input. Rule metadata (category, summary) lives in one table, `STYLE_GUIDE`, that tests compare
with the ruleset, the documentation headings and the seeded violations.

## Consequences

- Custom rule logic is type-checked and unit-tested like any other code; a rule cannot be added
  without documentation and a seeded violation, because tests compare the three.
- External references are refused by construction (tested with a local HTTP server that records
  zero requests), and the CLI controls size limits, exit codes and GitHub annotations.
- The ruleset is not a drop-in file for teams that already run `spectral lint`; they would import
  `ruleset` from this package in a JavaScript ruleset, or use the `contract lint` CLI. The
  project depends on Spectral's library packages directly, so Spectral upgrades are grouped in
  Dependabot and covered by the same tests.
