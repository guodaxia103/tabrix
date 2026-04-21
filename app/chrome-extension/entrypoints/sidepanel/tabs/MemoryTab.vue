<template>
  <section class="mkep-tab">
    <header class="mkep-tab__header">
      <h2 class="mkep-tab__title">Memory</h2>
      <p class="mkep-tab__subtitle">
        Browser automation execution history — Tasks, Sessions, Steps.
      </p>
    </header>

    <div class="mkep-placeholder">
      <div class="mkep-placeholder__badge">Coming in Stage 3e</div>
      <h3 class="mkep-placeholder__heading">Run History UI</h3>
      <p class="mkep-placeholder__body">
        This tab will surface Memory SQLite records (Task / ExecutionSession / ExecutionStep)
        captured by the native-server. For now the Memory tables are populated by MCP tool calls; a
        dedicated browser-side viewer ships in Stage 3e.
      </p>
      <ul class="mkep-placeholder__points">
        <li>Task timeline with per-step latency and status</li>
        <li>Intent / URL / pageRole breakdown</li>
        <li>Replay a prior session to recover a cached action path</li>
      </ul>
      <p class="mkep-placeholder__hint">
        See <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code> § Stage 3e for the spec.
      </p>
    </div>
  </section>
</template>

<script lang="ts" setup></script>

<style scoped>
@import './mkep-tab.css';
</style>
