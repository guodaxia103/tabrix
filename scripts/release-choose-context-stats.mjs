#!/usr/bin/env node
/**
 * V23-04 / B-018 v1.5 — release evidence script.
 *
 * Reads the `tabrix_choose_context_decisions` and
 * `tabrix_choose_context_outcomes` SQLite tables and prints a strategy
 * distribution report. Designed to be run by the release maintainer
 * (e.g. as part of `pnpm run release:check`) to answer "did the
 * chooser actually save us read_page round-trips this cycle?".
 *
 * Read-only by construction: this script only issues SELECT statements.
 *
 * Usage:
 *   pnpm run release:choose-context-stats
 *   pnpm run release:choose-context-stats -- --since 2026-04-15T00:00:00Z
 *   pnpm run release:choose-context-stats -- --db ./fixture.db --json
 *
 * Exit codes:
 *   0 — printed a report (rows may be zero on a fresh install; we
 *       intentionally do NOT fail on empty data here, the release-gate
 *       script enforces "must have evidence" separately).
 *   1 — invalid args, DB unreadable, or schema missing entirely.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const options = { dbPath: null, since: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) {
      options.dbPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--since' && argv[i + 1]) {
      options.since = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: release-choose-context-stats [--db <file>] [--since <ISO>] [--json]',
      '',
      '  --db <file>      SQLite memory.db path (defaults to ~/.chrome-mcp-agent/memory.db).',
      '  --since <ISO>    Only count decisions whose created_at >= this ISO timestamp.',
      '  --json           Emit machine-readable JSON instead of the table.',
      '',
    ].join('\n'),
  );
}

function defaultDbPath() {
  if (process.env.TABRIX_MEMORY_DB_FILE && process.env.TABRIX_MEMORY_DB_FILE.trim()) {
    return path.resolve(process.env.TABRIX_MEMORY_DB_FILE.trim());
  }
  return path.join(os.homedir(), '.chrome-mcp-agent', 'memory.db');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? defaultDbPath();

  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`[release-choose-context-stats] DB not found: ${dbPath}\n`);
    process.stderr.write(
      '  Run any chooser-driven flow first, or pass --db to point at a captured fixture.\n',
    );
    process.exit(1);
  }

  // We deliberately import better-sqlite3 lazily so this script can be
  // listed in `package.json#scripts` without making the binding a hard
  // root-install dependency for environments that never call it.
  let DatabaseCtor;
  try {
    ({ default: DatabaseCtor } = await import('better-sqlite3'));
  } catch (error) {
    process.stderr.write(
      '[release-choose-context-stats] better-sqlite3 binding missing.\n' +
        '  Run `pnpm install` in the repo root, then retry.\n',
    );
    process.stderr.write(`  Underlying error: ${error?.message ?? error}\n`);
    process.exit(1);
  }

  const db = new DatabaseCtor(dbPath, { readonly: true, fileMustExist: true });

  // Schema probe: refuse to operate on a DB that pre-dates V23-04 so
  // the release report does not silently report "0 rows" when really
  // the table just does not exist.
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('tabrix_choose_context_decisions', 'tabrix_choose_context_outcomes')`,
    )
    .all()
    .map((row) => row.name);
  if (
    !tables.includes('tabrix_choose_context_decisions') ||
    !tables.includes('tabrix_choose_context_outcomes')
  ) {
    process.stderr.write(
      `[release-choose-context-stats] DB ${dbPath} is missing the V23-04 telemetry tables.\n` +
        '  Open the DB once with the v2.3.0 native-server (or run a chooser flow) and retry.\n',
    );
    process.exit(1);
  }

  const decisionRows = args.since
    ? db
        .prepare(
          `SELECT strategy, COUNT(*) AS n
             FROM tabrix_choose_context_decisions
            WHERE created_at >= ?
            GROUP BY strategy`,
        )
        .all(args.since)
    : db
        .prepare(
          `SELECT strategy, COUNT(*) AS n
             FROM tabrix_choose_context_decisions
            GROUP BY strategy`,
        )
        .all();

  const outcomeRows = args.since
    ? db
        .prepare(
          `SELECT d.strategy AS strategy, o.outcome AS outcome, COUNT(*) AS n
             FROM tabrix_choose_context_outcomes o
             JOIN tabrix_choose_context_decisions d ON d.decision_id = o.decision_id
            WHERE d.created_at >= ?
            GROUP BY d.strategy, o.outcome`,
        )
        .all(args.since)
    : db
        .prepare(
          `SELECT d.strategy AS strategy, o.outcome AS outcome, COUNT(*) AS n
             FROM tabrix_choose_context_outcomes o
             JOIN tabrix_choose_context_decisions d ON d.decision_id = o.decision_id
            GROUP BY d.strategy, o.outcome`,
        )
        .all();

  db.close();

  const byStrategy = new Map();
  const empty = () => ({ reuse: 0, fallback: 0, completed: 0, retried: 0 });
  for (const row of decisionRows) {
    byStrategy.set(row.strategy, { strategy: row.strategy, decisions: row.n, outcomes: empty() });
  }
  for (const row of outcomeRows) {
    const slot = byStrategy.get(row.strategy) ?? {
      strategy: row.strategy,
      decisions: 0,
      outcomes: empty(),
    };
    slot.outcomes[row.outcome] = row.n;
    byStrategy.set(row.strategy, slot);
  }
  const ordered = Array.from(byStrategy.values()).sort((a, b) => b.decisions - a.decisions);
  const totalDecisions = ordered.reduce((acc, row) => acc + row.decisions, 0);

  if (args.json) {
    const payload = {
      dbPath,
      since: args.since ?? null,
      generatedAt: new Date().toISOString(),
      totalDecisions,
      strategies: ordered,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`tabrix_choose_context decisions (db=${dbPath})\n`);
  if (args.since) process.stdout.write(`  since=${args.since}\n`);
  process.stdout.write(`  totalDecisions=${totalDecisions}\n\n`);

  if (ordered.length === 0) {
    process.stdout.write('  (no decisions recorded yet)\n');
    return;
  }

  const headers = ['strategy', 'decisions', 'reuse', 'fallback', 'completed', 'retried', 'reuse%'];
  const widths = headers.map((h) => h.length);
  const rowsForTable = ordered.map((row) => {
    const total =
      row.outcomes.reuse + row.outcomes.fallback + row.outcomes.completed + row.outcomes.retried;
    const reusePct = total > 0 ? ((row.outcomes.reuse / total) * 100).toFixed(1) : 'n/a';
    const cells = [
      row.strategy,
      String(row.decisions),
      String(row.outcomes.reuse),
      String(row.outcomes.fallback),
      String(row.outcomes.completed),
      String(row.outcomes.retried),
      reusePct,
    ];
    cells.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cell.length);
    });
    return cells;
  });
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  process.stdout.write(`  ${fmt(headers)}\n`);
  process.stdout.write(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
  for (const row of rowsForTable) process.stdout.write(`  ${fmt(row)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[release-choose-context-stats] failed: ${error?.message ?? error}\n`);
  process.exit(1);
});
