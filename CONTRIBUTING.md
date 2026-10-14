# Contributing

Thanks for helping. This is a TypeScript and TypeSpec project; issues and pull requests are welcome.

## Set up and check your change

Needs Node.js 24+. Caches stay in git-ignored folders inside the repo.

```bash
make setup   # install dependencies (npm ci)
make lint    # strict TypeScript and TypeSpec formatting
make check   # committed openapi/openapi.yaml matches spec/ and passes the style guide
make test    # full test suite
make audit   # known-vulnerability check (as in CI)
make bench   # baseline, timing and seeded-violation detection
```

Changing the API: edit `spec/*.tsp`, run `make spec` to regenerate `openapi/openapi.yaml`, and
commit both. CI fails if the two disagree. Without `make`, run the matching `npm run` scripts
(`lint`, `spec`, `check`, `test`, `measure`).

A pull request is ready when `make lint`, `make check` and `make test` pass and CI is green.

## Guidelines

- Keep each change focused; explain the problem it solves in the pull request.
- Add or update a test for every behaviour change, and update `docs/results/` when numbers change.
- A new style rule needs an entry in `STYLE_GUIDE` (`src/ruleset.ts`), a heading in
  `docs/style-guide.md` and a seeded violation in `src/mutations.ts`; tests fail otherwise.
- Significant design changes need an ADR in `docs/adr/` (copy `0001` for the format).
- Keep function comments to one short phrase; let names and tests explain the rest.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

By contributing you agree that your work is released under the [MIT License](LICENSE).
