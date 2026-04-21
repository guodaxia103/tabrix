<template>
  <section class="mkep-tab">
    <header class="mkep-tab__header">
      <h2 class="mkep-tab__title">Knowledge</h2>
      <p class="mkep-tab__subtitle">
        Structured site cognition — Site Profile, Page Catalog, UI Map, API Endpoints.
      </p>
    </header>

    <div class="mkep-placeholder">
      <div class="mkep-placeholder__badge">Coming in Stage 3d / 3g</div>
      <h3 class="mkep-placeholder__heading">Knowledge Registry Viewer</h3>
      <p class="mkep-placeholder__body">
        Today the Knowledge Registry ships as code-side seeds (see
        <code>entrypoints/background/knowledge/seeds/</code>) driven by
        <code>inferPageUnderstanding</code> and the HVO classifier. This tab will provide a
        read-only viewer of the registered rules, plus the upcoming UI Map and API Endpoint catalog.
      </p>
      <ul class="mkep-placeholder__points">
        <li>Site Profile + Page Catalog overview</li>
        <li>UI Map locator rules with per-site coverage</li>
        <li>API Endpoint catalog (Stage 3g golden idea)</li>
      </ul>
      <p class="mkep-placeholder__hint">
        See <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code> § Stage 3d / 3g.
      </p>
    </div>
  </section>
</template>

<script lang="ts" setup></script>

<style scoped>
@import './mkep-tab.css';
</style>
