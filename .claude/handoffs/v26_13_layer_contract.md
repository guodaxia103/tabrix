# V26-13 Layer Contract v1 Handoff

## Status

Completed locally as an atomic V26-13 package. Not pushed, not tagged, not published, no version bump.

## What Changed

- Added internal `mapDataSourceToLayerContract(...)` in `app/native-server/src/execution/layer-contract.ts`.
- Mapped data sources onto the common L0/L1/L2 contract:
  - `api_rows` -> `L0+L1`, no locator/execution authority;
  - `api_detail` -> `L0+L1+L2` only when detail is required;
  - `markdown` -> reading surface, no locator/execution authority;
  - `dom_json` -> locator/execution authority.
- Added `layerContract` evidence to API rows `chrome_read_page` envelopes.
- Kept fallback clamp to `L0` / `L0+L1`; no public `read_page` schema change.

## Why

V26-13 needed API and Markdown outputs to obey the same layer policy as DOM reads. API rows are useful list data, but they must not become click locator authority or silently widen fallback to L2.

## Verification

- `pnpm -C app/native-server test:ci --% --testPathPattern "layer-contract|skip-read|v26-benchmark"`: PASS, 4 suites / 55 tests.
- `pnpm -r typecheck`: PASS.
- `pnpm -C app/native-server build`: PASS.
- `pnpm run docs:check`: PASS.
- `git diff --check`: PASS, only Git CRLF conversion warnings.

## Not Verified

- Real Gate B was not run in this package.
- Extension build/reload was not run because this package touched native-server only.

## Remaining Risk

- Bridge-forwarded DOM responses are not wrapped with `layerContract` yet; this package added evidence to the API rows production envelope first.
- Markdown execution remains an existing reading signal, not a rewritten data-source adapter.

## Commit

- Commit SHA: recorded in final report after the atomic commit is created.
- Push status: not pushed by instruction.
