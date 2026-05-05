import assert from 'node:assert/strict';

import {
  CAPABILITY_GATED_TOOLS,
  P3_EXPLICIT_OPT_IN_TOOLS,
  TOOL_NAMES,
  TOOL_RISK_TIERS,
  TOOL_SCHEMAS,
  getRequiredCapability,
  getToolRiskTier,
  isCapabilityGatedTool,
  isExplicitOptInTool,
} from '../dist/index.mjs';

function flattenToolNames(value, out = new Set()) {
  if (typeof value === 'string') {
    out.add(value);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      flattenToolNames(child, out);
    }
  }
  return out;
}

const allToolNames = flattenToolNames(TOOL_NAMES);
const schemaNames = TOOL_SCHEMAS.map((schema) => schema.name);
const schemaNameSet = new Set(schemaNames);
const riskTierNames = Object.keys(TOOL_RISK_TIERS);

assert.ok(schemaNames.length > 0, 'TOOL_SCHEMAS must expose at least one tool schema');
assert.equal(schemaNameSet.size, schemaNames.length, 'TOOL_SCHEMAS must not contain duplicate names');

for (const name of schemaNames) {
  assert.ok(allToolNames.has(name), `schema tool "${name}" must be declared in TOOL_NAMES`);
  assert.ok(getToolRiskTier(name), `schema tool "${name}" must have a risk tier`);
}

for (const name of riskTierNames) {
  assert.ok(allToolNames.has(name), `risk-tier key "${name}" must be declared in TOOL_NAMES`);
}

for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
  assert.equal(getToolRiskTier(name), 'P3', `explicit opt-in tool "${name}" must be P3`);
  assert.equal(isExplicitOptInTool(name), true, `explicit opt-in helper must recognize "${name}"`);
}

for (const [name, capability] of CAPABILITY_GATED_TOOLS.entries()) {
  assert.ok(allToolNames.has(name), `capability-gated tool "${name}" must be declared in TOOL_NAMES`);
  assert.ok(getToolRiskTier(name), `capability-gated tool "${name}" must have a risk tier`);
  assert.equal(isCapabilityGatedTool(name), true, `capability helper must recognize "${name}"`);
  assert.equal(getRequiredCapability(name), capability, `capability helper must return "${capability}" for "${name}"`);
}

console.log(
  JSON.stringify({
    status: 'PASS',
    schemaCount: schemaNames.length,
    riskTierCount: riskTierNames.length,
    explicitOptInCount: P3_EXPLICIT_OPT_IN_TOOLS.size,
    capabilityGatedCount: CAPABILITY_GATED_TOOLS.size,
  }),
);
