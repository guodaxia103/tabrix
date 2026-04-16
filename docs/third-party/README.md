# Third-Party Source Records

Use this directory for repository-local source records whenever a Tabrix task or PR is influenced by an external repository, package, code snippet, or design reference.

Canonical rules:

- [Third-Party Reuse Matrix](../THIRD_PARTY_REUSE_MATRIX.md)
- [第三方复用矩阵](../THIRD_PARTY_REUSE_MATRIX_zh.md)
- [Third-Party Reuse Workflow](../THIRD_PARTY_REUSE_WORKFLOW.md)
- [第三方复用工作流](../THIRD_PARTY_REUSE_WORKFLOW_zh.md)

## File Convention

- One upstream project per file
- Recommended filename: `docs/third-party/<project>.md`
- Reuse the same file when the same upstream is referenced again

Examples:

- `docs/third-party/rrweb.md`
- `docs/third-party/playwright-mcp.md`
- `docs/third-party/openreplay.md`

## Minimal Template

```md
# <project>

- Repository:
- Reviewed version / tag / commit / package:
- Repository license:
- Exact package or path license used:
- Classification: direct | rewrite | design-only
- Tabrix task / PR:
- Affected Tabrix paths:
- NOTICE updated: yes | no

## Notes

- What was copied or depended on:
- If rewrite/design-only, explicitly state that restricted code was not copied:
- Follow-up checks:
```

## Rule of Thumb

- `direct`: update this record and `NOTICE`
- `rewrite`: update this record, no `NOTICE`
- `design-only`: update this record, mark it clearly, no `NOTICE`
