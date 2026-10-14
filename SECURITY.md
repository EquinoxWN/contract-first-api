# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**Security > Report a vulnerability** on this repository
(`https://github.com/EquinoxWN/contract-first-api/security/advisories/new`). Do not open a public issue.

Include what you found, how to reproduce it, and the impact you expect. You will get an answer
within 7 days. Fixes are released as soon as they are ready, and you are credited unless you ask
not to be.

## Supported versions

This project is pre-1.0. Only the latest commit on `main` receives fixes.

## Scope

- **In scope:** A spec file that makes `contract lint` read files or URLs other than the one it was
  given (external `$ref`s), hang or exhaust memory (alias expansion, oversized input), or crash
  instead of reporting an error; `contract build` writing outside its project root; a style-guide
  violation the linter misses.
- **Out of scope:** TypeSpec, Spectral and other upstream packages themselves (report those
  upstream), and servers built from the example API.

## How this repository protects itself

- Every GitHub Action is pinned to a full commit SHA, and workflows run with read-only
  permissions and without persisted credentials.
- Dependabot update pull requests are paused (`open-pull-requests-limit: 0`) so the repository keeps a single `main` branch; dependencies are updated by hand and checked by the CI audit.
- CI runs lint, tests and a known-vulnerability check (npm audit) on every push and pull request.
- npm dependencies are pinned to exact versions with a committed `package-lock.json`; install
  scripts are disabled (`.npmrc`), and install-time analytics are turned off.
- The linter reads at most 5 MiB per file, rejects invalid UTF-8, duplicate keys, multi-document
  YAML and more than 100 alias expansions, and never resolves external `$ref`s.
