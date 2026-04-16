# Third-Party Reuse Workflow

Last updated: `2026-04-15 Asia/Shanghai`
Scope: any task or PR that touches external repositories, npm packages, code snippets, or design references

Related documents:

- [Third-Party Reuse Matrix](./THIRD_PARTY_REUSE_MATRIX.md)
- [第三方复用矩阵](./THIRD_PARTY_REUSE_MATRIX_zh.md)
- [third-party source records](./third-party/README.md)
- [`NOTICE`](../NOTICE)

## 1. Classify First

- `direct`
  - You are adding a package, vendoring upstream source, copying code, or shipping third-party files with Tabrix.
- `rewrite`
  - You studied an external implementation but rewrote the Tabrix code locally.
- `design-only`
  - You only reused product ideas, interaction patterns, information architecture, or metrics.

## 2. License Rule

- `MIT` and `Apache-2.0`
  - May enter the `direct` candidate pool, but only after checking the exact package, path, and shipped artifact.
- `AGPL`, commercial, or mixed/unclear licensing
  - Defaults to `design-only`.
- If repo, package, or subdirectory licenses differ
  - The exact package or path you ship wins. If unclear, do not merge.

## 3. Required Records

### For `direct`

- Update `NOTICE`
- Add or update a source record under `docs/third-party/`
- Mention project, version/commit, target path, and license in the PR

### For `rewrite`

- Do not update `NOTICE`
- Add or update a source record under `docs/third-party/`
- State clearly in the PR that the implementation was rewritten locally

### For `design-only`

- Do not update `NOTICE`
- Add or update a source record under `docs/third-party/`
- Mark the record as `design-only`

## 4. Source Record Convention

- Store records in `docs/third-party/`
- Use one file per upstream project, for example `docs/third-party/rrweb.md`
- Reuse the template in [docs/third-party/README.md](./third-party/README.md)

Each record should include:

- upstream project and repository link
- reviewed version, tag, commit, or package version
- repo-root license and the exact package/path license actually used
- classification: `direct`, `rewrite`, or `design-only`
- affected Tabrix task, PR, and file paths
- whether `NOTICE` changed
- what was copied, or an explicit note that no code was copied

## 5. Fixed Rule for AGPL / Commercial Sources

- Default classification is `design-only`
- These sources may inform research and product direction
- They must not be used as a temporary shortcut for direct code import
- If a future task wants to use an isolated permissive subdirectory, that path must be reviewed separately before the default rule changes

## 6. Extra Check for Future npm Packages

- Do not rely only on the repository homepage license
- Check npm metadata, bundled `LICENSE`/`NOTICE`, release notes, and shipped files
- If the package artifact differs from the repository license story, follow the shipped package
- If the result is unclear, do not merge

## 7. PR / Release Gates

### PR must answer

- Did this PR use third-party code, a dependency, or a design reference?
- Is it `direct`, `rewrite`, or `design-only`?
- Does `NOTICE` need an update?
- Where is the source record under `docs/third-party/`?

### Release must confirm

- New or updated shipped third-party materials all have source records
- Required attributions are present in `NOTICE`
- No `AGPL` or commercial-restricted code entered the release by mistake

## 8. Current Repository Conclusion

- direct-candidate: `playwright-mcp`, `rrweb`, `selenium-ide`
- rewrite-reference: `stagehand`, `browser-use`
- design-only: `openreplay`, `automa`
