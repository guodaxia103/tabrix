<template>
  <section class="mkep-tab">
    <header class="mkep-tab__header">
      <h2 class="mkep-tab__title">Experience</h2>
      <p class="mkep-tab__subtitle"> Learnable, reusable action paths and recovery strategies. </p>
    </header>

    <div class="mkep-placeholder">
      <div class="mkep-placeholder__badge">Coming in Stage 4</div>
      <h3 class="mkep-placeholder__heading">Experience Deck</h3>
      <p class="mkep-placeholder__body">
        The Experience layer promotes high-quality Memory traces into reusable, token-efficient
        action recipes. This tab will expose the Experience Deck: a browsable, shareable catalogue
        of validated action paths per (site, pageRole, intent).
      </p>
      <ul class="mkep-placeholder__points">
        <li>Import / export personal Experience packs</li>
        <li>Per-experience hit-rate, cost, and freshness</li>
        <li>One-click <code>experience_replay</code> to execute a cached path</li>
      </ul>
      <p class="mkep-placeholder__hint">
        See <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code> § Stage 4.
      </p>
    </div>
  </section>
</template>

<script lang="ts" setup></script>

<style scoped>
@import './mkep-tab.css';
</style>
