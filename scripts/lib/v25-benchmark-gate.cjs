/**
 * Tabrix v2.5 release gate — canonical, fresh-checkout-safe source.
 *
 * Independent module from `v23-benchmark-gate.cjs` and
 * `v24-benchmark-gate.cjs`: each `vX` gate is the ship contract for
 * its own minor version and must remain untouched once that minor
 * shipped. This file owns the v2.5 gate and applies ONLY to v2.5+
 * tags (`benchmarkGateAppliesV25`).
 *
 * Current release-gate status: this library is wired into
 * `scripts/check-release-readiness.mjs` for v2.5.0+ tags. It is still
 * exported so `scripts/benchmark-v25.mjs --gate` can use it locally
 * and release-gate tests can fixture-test it end-to-end.
 *
 * Hard invariants (v2.5 release blockers, per V3.1 §V25-05 step 2):
 *   - reportVersion === BENCHMARK_REPORT_VERSION_EXPECTED (= 1).
 *   - laneCounters present, internally consistent, no violations.
 *   - K3 task success rate ≥ 0.85 (mirrors v23/v24).
 *   - K4 tool retry rate ≤ 0.10 (mirrors v23/v24).
 *   - At least one scenario.
 *   - `pairedRunCount >= 3` for every KPI scenario. KPI scenarios are
 *     declared by the runner via the report's `kpiScenarioIds[]`. Empty
 *     list means "every scenario is KPI-graded".
 *   - L0 token estimate ratio (median) ≤ 0.35.
 *   - L0+L1 token estimate ratio (median) ≤ 0.60.
 *   - K3 ≥ baseline.k3 - 0.02 (regression ceiling).
 *   - K4 ≤ baseline.k4 + 0.01 (retry-rate regression ceiling).
 *   - v25 median tool calls per scenario ≤ baseline + 0.
 *   - v25 click attempts per success median ≤ baseline.
 *   - Visual fallback rate ≤ max(0.05, baseline.visualFallbackRate).
 *   - JS fallback rate ≤ max(0.02, baseline.jsFallbackRate).
 *   - Release notes MUST NOT contain `__V25_TBD__` placeholders.
 *
 * Soft invariants (evidence-only, surfaced as `WARN:` reasons): none
 * defined for v2.5 yet — the v2.5 thesis is "the layer dispatch and
 * stability deltas are HARD release evidence, not WARN-only." Keeping
 * the soft bucket gives V25-05 head-room to add per-package guidance
 * without re-shaping this file.
 *
 * Module format: CommonJS (`.cjs`). Same rationale as v23/v24 — must
 * be loadable by both Jest tests (`require()`) and the ESM scripts
 * (`scripts/benchmark-v25.mjs`, `scripts/check-release-readiness.mjs`)
 * without depending on the native-server `dist/` build artifact.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * MUST equal `BENCHMARK_REPORT_VERSION` in
 * `app/native-server/src/benchmark/v25-benchmark.ts`. The cross-source
 * equality is enforced by `v25-benchmark.test.ts`.
 */
const BENCHMARK_REPORT_VERSION_EXPECTED = 1;

const DEFAULT_BENCHMARK_GATE_THRESHOLDS_V25 = Object.freeze({
  /** Hard: maximum allowed tool retry rate (K4a). PRD §K4. */
  maxToolRetryRate: 0.1,
  /** Hard: minimum scenario completion rate (K3). PRD §K3. */
  minScenarioCompletionRate: 0.85,
  /** Hard: minimum complete pairs per KPI scenario. */
  minPairCountPerKpiScenario: 3,
  /** Hard: maximum L0 token ratio (chosen / fullRead). V3.1 §V25-05 step 2. */
  maxL0TokenRatio: 0.35,
  /** Hard: maximum L0+L1 token ratio. V3.1 §V25-05 step 2. */
  maxL0L1TokenRatio: 0.6,
  /** Hard: K3 regression ceiling vs baseline. */
  k3RegressionCeiling: 0.02,
  /** Hard: K4 regression ceiling vs baseline. */
  k4RegressionCeiling: 0.01,
  /** Hard: median tool calls per scenario regression ceiling vs baseline. */
  medianToolCallsRegressionCeiling: 0,
  /**
   * Hard: visual fallback rate ceiling. The V3.1 spec says
   * `<= max(0.05, v24 measured)` — the gate evaluates this at
   * comparison time. Standalone `noBaseline` mode uses the literal
   * `0.05`.
   */
  maxVisualFallbackRateAbsolute: 0.05,
  /** Hard: JS fallback rate ceiling, same `max(0.02, baseline)` rule. */
  maxJsFallbackRateAbsolute: 0.02,
  /**
   * Hard: minimum primary-tab reuse rate when the runner emits a
   * `tabHygiene` block. V3.1 §"V25-05 Closeout Addendum: Browser
   * Tab Hygiene" step 8. When the report omits `tabHygiene`
   * altogether (legacy NDJSON), the gate stays silent — the runner
   * contract is enforced by the helper module
   * (`scripts/lib/v25-primary-tab-session.cjs`), not retroactively
   * against pre-helper runs.
   */
  minPrimaryTabReuseRate: 0.95,
  /**
   * Hard: maximum concurrent benchmark tabs. Same V3.1 reference.
   * Allowlisted-new-tab scenarios are factored into the runner-side
   * `expectedPrimaryTabNavigations` denominator already; the absolute
   * concurrency ceiling still applies (a runaway suite must not leak
   * a tab per scenario).
   */
  maxConcurrentTabsAbsolute: 2,
});

const KNOWN_LANES = new Set(['tabrix_owned', 'cdp', 'debugger', 'unknown']);
const KNOWN_SOURCE_ROUTES = new Set([
  'read_page_required',
  'experience_replay_skip_read',
  'knowledge_supported_read',
  'dispatcher_fallback_safe',
]);
const KNOWN_CHOSEN_LAYERS = new Set(['L0', 'L0+L1', 'L0+L1+L2']);

/**
 * Sentinel string the V25-05 release notes draft uses for unknown
 * real numbers. The gate refuses to ship release notes that still
 * carry this token (V3.1 §V25-05 step 2).
 */
const RELEASE_NOTES_PLACEHOLDER_TOKEN = '__V25_TBD__';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function evaluateBenchmarkGateV25(summary, thresholds = DEFAULT_BENCHMARK_GATE_THRESHOLDS_V25) {
  const reasons = [];

  if (!summary || typeof summary !== 'object') {
    return ['report is not a JSON object'];
  }

  const reportVersion = summary.reportVersion;
  if (reportVersion !== BENCHMARK_REPORT_VERSION_EXPECTED) {
    reasons.push(
      `report version mismatch: expected ${BENCHMARK_REPORT_VERSION_EXPECTED}, got ${String(reportVersion)}`,
    );
  }

  const totalScenarios = Number(summary.totalScenarios);
  if (!Number.isFinite(totalScenarios) || totalScenarios <= 0) {
    reasons.push('no scenarios in run — release evidence is empty');
  }

  const laneCounters = summary.laneCounters;
  if (!laneCounters || typeof laneCounters !== 'object') {
    reasons.push('laneCounters block missing from report');
  } else {
    const cdpCount = Number(laneCounters.cdpCount) || 0;
    const debuggerCount = Number(laneCounters.debuggerCount) || 0;
    const violationCount = Number(laneCounters.violationCount);
    const computedViolations = cdpCount + debuggerCount;
    if (Number.isFinite(violationCount) && violationCount !== computedViolations) {
      reasons.push(
        `lane counters self-inconsistent: violationCount=${violationCount} but cdp+debugger=${computedViolations}`,
      );
    }
    const effectiveViolations = Number.isFinite(violationCount)
      ? violationCount
      : computedViolations;
    if (effectiveViolations > 0) {
      reasons.push(
        `lane-integrity violations present: cdp=${cdpCount}, debugger=${debuggerCount}`,
      );
    }
  }

  const method = summary.methodMetrics || {};
  const k3 = method.k3TaskSuccessRate;
  if (
    isFiniteNumber(k3) &&
    k3 < thresholds.minScenarioCompletionRate
  ) {
    reasons.push(
      `K3 task success rate ${k3.toFixed(3)} below threshold ${thresholds.minScenarioCompletionRate}`,
    );
  }

  const k4 = method.k4ToolRetryRate;
  if (
    isFiniteNumber(k4) &&
    k4 > thresholds.maxToolRetryRate
  ) {
    reasons.push(
      `K4 tool retry rate ${k4.toFixed(3)} above threshold ${thresholds.maxToolRetryRate}`,
    );
  }

  // Per-KPI-scenario `pairedRunCount` enforcement.
  const scenarioSummaries = Array.isArray(summary.scenarioSummaries)
    ? summary.scenarioSummaries
    : [];
  const summariesById = new Map();
  for (const block of scenarioSummaries) {
    if (block && typeof block.scenarioId === 'string') {
      summariesById.set(block.scenarioId, block);
    }
  }
  const declaredKpiIds = Array.isArray(summary.kpiScenarioIds) ? summary.kpiScenarioIds : [];
  const effectiveKpiIds =
    declaredKpiIds.length > 0
      ? declaredKpiIds
      : scenarioSummaries
          .map((block) => (block && block.scenarioId) || '')
          .filter((id) => id.length > 0);

  for (const scenarioId of effectiveKpiIds) {
    const block = summariesById.get(scenarioId);
    if (!block) {
      reasons.push(
        `KPI scenario "${scenarioId}" missing scenarioSummaries entry — runner did not emit it`,
      );
      continue;
    }
    const pairedRunCount = Number(block.pairedRunCount);
    if (
      !Number.isFinite(pairedRunCount) ||
      pairedRunCount < thresholds.minPairCountPerKpiScenario
    ) {
      reasons.push(
        `KPI scenario "${scenarioId}" has pairedRunCount=${pairedRunCount} below required ${thresholds.minPairCountPerKpiScenario}`,
      );
    }
  }

  const layer = summary.layerMetrics || {};
  const l0Ratio = layer.l0TokenRatioMedian;
  if (isFiniteNumber(l0Ratio) && l0Ratio > thresholds.maxL0TokenRatio) {
    reasons.push(
      `L0 token-ratio median ${l0Ratio.toFixed(3)} above ceiling ${thresholds.maxL0TokenRatio}`,
    );
  }
  const l0L1Ratio = layer.l0L1TokenRatioMedian;
  if (isFiniteNumber(l0L1Ratio) && l0L1Ratio > thresholds.maxL0L1TokenRatio) {
    reasons.push(
      `L0+L1 token-ratio median ${l0L1Ratio.toFixed(3)} above ceiling ${thresholds.maxL0L1TokenRatio}`,
    );
  }

  // Source-route sanity: every emitted route must be one of the four
  // closed values from the V25-02 kickoff binding. Any non-empty
  // `unknown` bucket is a runner bug worth flagging.
  const route = layer.sourceRouteDistribution || {};
  const routeUnknown = Number(route.unknown) || 0;
  if (routeUnknown > 0) {
    reasons.push(
      `sourceRoute "unknown" bucket has ${routeUnknown} entries — runner emitted a route value outside the closed enum [${[...KNOWN_SOURCE_ROUTES].join(',')}]`,
    );
  }
  const chosenLayer = layer.chosenLayerDistribution || {};
  const chosenUnknown = Number(chosenLayer.unknown) || 0;
  if (chosenUnknown > 0) {
    reasons.push(
      `chosenLayer "unknown" bucket has ${chosenUnknown} entries — runner emitted a layer value outside [${[...KNOWN_CHOSEN_LAYERS].join(',')}]`,
    );
  }

  // Comparison-to-baseline checks. When the report carries a
  // `comparisonToV24` block, the four regression-vs-baseline gates
  // apply. When no baseline is provided the gate falls back to the
  // absolute `max(0.05, ...)` / `max(0.02, ...)` rule (using the
  // absolute floor only).
  const comparison = summary.comparisonToV24;
  const stability = summary.stabilityMetrics || {};
  if (comparison && typeof comparison === 'object') {
    const deltas = comparison.deltas || {};

    const k3Delta = deltas.k3TaskSuccessRate;
    if (isFiniteNumber(k3Delta) && k3Delta < -thresholds.k3RegressionCeiling) {
      reasons.push(
        `K3 regressed by ${k3Delta.toFixed(3)} vs v2.4 baseline (ceiling ${thresholds.k3RegressionCeiling})`,
      );
    }
    const k4Delta = deltas.k4ToolRetryRate;
    if (isFiniteNumber(k4Delta) && k4Delta > thresholds.k4RegressionCeiling) {
      reasons.push(
        `K4 regressed by ${k4Delta.toFixed(3)} vs v2.4 baseline (ceiling ${thresholds.k4RegressionCeiling})`,
      );
    }
    const medianCallsDelta = deltas.medianToolCallsPerScenario;
    if (
      isFiniteNumber(medianCallsDelta) &&
      medianCallsDelta > thresholds.medianToolCallsRegressionCeiling
    ) {
      reasons.push(
        `median tool calls per scenario regressed by ${medianCallsDelta.toFixed(3)} vs v2.4 baseline (ceiling ${thresholds.medianToolCallsRegressionCeiling})`,
      );
    }
    const clickDelta = deltas.clickAttemptsPerSuccess;
    if (isFiniteNumber(clickDelta) && clickDelta > 0) {
      reasons.push(
        `click attempts per success regressed by ${clickDelta.toFixed(3)} vs v2.4 baseline`,
      );
    }
    const visualDelta = deltas.visualFallbackRate;
    if (isFiniteNumber(visualDelta) && visualDelta > 0) {
      // Apply the `max(0.05, baseline)` rule: the v25 absolute value
      // is still allowed when below the absolute floor regardless of
      // the delta sign. We can compute v25 absolute by subtracting
      // the delta from the baseline (or read it from
      // stabilityMetrics directly).
      const v25Visual = stability.visualFallbackRate;
      if (isFiniteNumber(v25Visual) && v25Visual > thresholds.maxVisualFallbackRateAbsolute) {
        reasons.push(
          `visual fallback rate ${v25Visual.toFixed(3)} above max(${thresholds.maxVisualFallbackRateAbsolute}, baseline) ceiling`,
        );
      }
    }
    const jsDelta = deltas.jsFallbackRate;
    if (isFiniteNumber(jsDelta) && jsDelta > 0) {
      const v25Js = stability.jsFallbackRate;
      if (isFiniteNumber(v25Js) && v25Js > thresholds.maxJsFallbackRateAbsolute) {
        reasons.push(
          `JS fallback rate ${v25Js.toFixed(3)} above max(${thresholds.maxJsFallbackRateAbsolute}, baseline) ceiling`,
        );
      }
    }
  } else {
    // No baseline. Absolute-floor checks still apply.
    const v25Visual = stability.visualFallbackRate;
    if (isFiniteNumber(v25Visual) && v25Visual > thresholds.maxVisualFallbackRateAbsolute) {
      reasons.push(
        `visual fallback rate ${v25Visual.toFixed(3)} above absolute ceiling ${thresholds.maxVisualFallbackRateAbsolute} (no baseline)`,
      );
    }
    const v25Js = stability.jsFallbackRate;
    if (isFiniteNumber(v25Js) && v25Js > thresholds.maxJsFallbackRateAbsolute) {
      reasons.push(
        `JS fallback rate ${v25Js.toFixed(3)} above absolute ceiling ${thresholds.maxJsFallbackRateAbsolute} (no baseline)`,
      );
    }
  }

  // Browser tab hygiene gate (V25-05 closeout addendum). Only
  // evaluated when the runner emitted a tabHygiene block; when the
  // report carries `tabHygiene: null` the gate is intentionally
  // silent so legacy NDJSON without the runner helper is not
  // retroactively rejected.
  const hygiene = summary.tabHygiene;
  if (hygiene && typeof hygiene === 'object') {
    const reuse = hygiene.primaryTabReuseRate;
    if (isFiniteNumber(reuse) && reuse < thresholds.minPrimaryTabReuseRate) {
      reasons.push(
        `primaryTabReuseRate ${reuse.toFixed(3)} below floor ${thresholds.minPrimaryTabReuseRate} (V25-05 tab hygiene)`,
      );
    }
    const maxConcurrent = Number(hygiene.maxConcurrentTabs);
    if (
      Number.isFinite(maxConcurrent) &&
      maxConcurrent > thresholds.maxConcurrentTabsAbsolute
    ) {
      reasons.push(
        `maxConcurrentTabs ${maxConcurrent} above absolute ceiling ${thresholds.maxConcurrentTabsAbsolute} (V25-05 tab hygiene)`,
      );
    }
    const violations = Array.isArray(hygiene.tabHygieneViolations)
      ? hygiene.tabHygieneViolations
      : [];
    if (violations.length > 0) {
      const kindCounts = new Map();
      for (const v of violations) {
        const kind = v && typeof v.kind === 'string' && v.kind ? v.kind : 'unknown';
        kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);
      }
      const summaryStr = [...kindCounts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([kind, n]) => `${kind}=${n}`)
        .join(',');
      reasons.push(
        `tabHygieneViolations present: ${violations.length} violation(s) [${summaryStr}] (V25-05 tab hygiene)`,
      );
    }
  }

  return reasons;
}

/** Soft reasons begin with "WARN:" — kept for parity with v23/v24 even though v25 currently has no soft reasons. */
function partitionGateReasons(reasons) {
  const hard = [];
  const soft = [];
  for (const reason of reasons) {
    if (reason.startsWith('WARN:')) soft.push(reason);
    else hard.push(reason);
  }
  return { hard, soft };
}

function parseSemverPrefix(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Whether the v25 gate applies to a given semver. v2.5.0+ → true.
 * v2.4.x and below → false (those use the v23/v24 gates).
 */
function benchmarkGateAppliesV25(version) {
  const semver = parseSemverPrefix(version);
  if (!semver) return false;
  if (semver.major > 2) return true;
  if (semver.major < 2) return false;
  return semver.minor >= 5;
}

function loadAndEvaluateBenchmarkReportV25(filePath, thresholds) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = `cannot read benchmark report ${filePath}: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg, hardReasons: [msg], softReasons: [] };
  }

  let summary;
  try {
    summary = JSON.parse(raw);
  } catch (err) {
    const msg = `benchmark report ${path.basename(filePath)} is not valid JSON: ${err && err.message ? err.message : String(err)}`;
    return { ok: false, reasons: [msg], parseError: msg, hardReasons: [msg], softReasons: [] };
  }

  const reasons = evaluateBenchmarkGateV25(summary, thresholds);
  const { hard, soft } = partitionGateReasons(reasons);
  return {
    ok: hard.length === 0,
    reasons,
    hardReasons: hard,
    softReasons: soft,
    parseError: null,
    summary,
  };
}

/**
 * Locate the most recent v25-vs-v24 baseline-comparison markdown table
 * under `benchmarkDir`. Naming convention: `v25-vs-v24-baseline-<date>.md`.
 * Returns `{ ok, reason?, tablePath? }`.
 */
function findBaselineComparisonTableV25(benchmarkDir) {
  if (!fs.existsSync(benchmarkDir)) {
    return { ok: false, reason: `baseline directory missing: ${benchmarkDir}` };
  }
  const candidates = fs
    .readdirSync(benchmarkDir)
    .filter((name) => /^v25-vs-v24-baseline-.*\.md$/.test(name))
    .map((name) => {
      const full = path.join(benchmarkDir, name);
      const stat = fs.statSync(full);
      return { name, full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: `no v25-vs-v24-baseline-*.md file found in ${benchmarkDir}`,
    };
  }
  return { ok: true, tablePath: candidates[0].full };
}

/**
 * Verify the release notes file INLINES the v25-vs-v24 baseline
 * comparison table AND that the notes contain no
 * `__V25_TBD__` placeholders. Mirrors the v24 closeout review-fix
 * (the notes must carry the actual numbers, not just a file link).
 *
 * Returns `{ ok, reasons[], tablePath? }`. The `reasons` array is
 * non-empty iff `ok === false`.
 */
function requireBaselineComparisonTableV25(notesPath, benchmarkDir) {
  const tableResult = findBaselineComparisonTableV25(benchmarkDir);
  if (!tableResult.ok) {
    return { ok: false, reasons: [tableResult.reason] };
  }
  if (!notesPath || !fs.existsSync(notesPath)) {
    return {
      ok: false,
      reasons: [`release notes file missing: ${notesPath}`],
      tablePath: tableResult.tablePath,
    };
  }
  const notes = fs.readFileSync(notesPath, 'utf8');
  const lines = notes.split(/\r?\n/);

  const reasons = [];

  // Inline-table contract.
  const headerLineRegex =
    /^\s*\|?\s*metric\s*\|\s*v2\.4(?:\.0)?\s+baseline\s*\|\s*v2\.5(?:\.0)?\s+median\s*\|\s*delta\s*\|\s*direction\s*\|?\s*$/i;

  let headerLineIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headerLineRegex.test(lines[i])) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex === -1) {
    reasons.push(
      `release notes ${path.basename(notesPath)} does NOT inline the v25-vs-v24 baseline comparison table ` +
        `(expected canonical header "metric | v2.4 baseline | v2.5 median | delta | direction"). ` +
        `A bare reference to a separate comparison file is not sufficient — the table itself must be inlined.`,
    );
  } else {
    let cursor = headerLineIndex + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
    const separatorLine = cursor < lines.length ? lines[cursor] : '';
    const separatorOk = /^\s*\|?[\s\-|:]*-[\s\-|:]*\|?\s*$/.test(separatorLine);
    if (!separatorOk) {
      reasons.push(
        `release notes ${path.basename(notesPath)} mentions the baseline comparison header but does not follow it with a markdown table separator (\`| --- |\`-style row).`,
      );
    } else {
      let hasDataRow = false;
      for (let i = cursor + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim() === '') continue;
        if (!line.trim().startsWith('|')) break;
        if (/^\s*\|?[\s\-|:]*\|?\s*$/.test(line)) continue;
        hasDataRow = true;
        break;
      }
      if (!hasDataRow) {
        reasons.push(
          `release notes ${path.basename(notesPath)} has the baseline comparison header + separator but no body rows — the inline table is empty.`,
        );
      }
    }
  }

  // Placeholder rejection — V25-05 step 2.
  if (notes.includes(RELEASE_NOTES_PLACEHOLDER_TOKEN)) {
    reasons.push(
      `release notes ${path.basename(notesPath)} still contains the ${RELEASE_NOTES_PLACEHOLDER_TOKEN} placeholder — replace every occurrence with real measured values before shipping.`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    tablePath: tableResult.tablePath,
  };
}

module.exports = {
  BENCHMARK_REPORT_VERSION_EXPECTED,
  DEFAULT_BENCHMARK_GATE_THRESHOLDS_V25,
  KNOWN_LANES,
  KNOWN_SOURCE_ROUTES,
  KNOWN_CHOSEN_LAYERS,
  RELEASE_NOTES_PLACEHOLDER_TOKEN,
  evaluateBenchmarkGateV25,
  partitionGateReasons,
  parseSemverPrefix,
  benchmarkGateAppliesV25,
  loadAndEvaluateBenchmarkReportV25,
  findBaselineComparisonTableV25,
  requireBaselineComparisonTableV25,
};
