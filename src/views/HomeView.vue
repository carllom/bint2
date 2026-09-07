<script setup lang="ts">
// Phase-1 app shell. Empty regions only: the toolbar, dead-source banner,
// Viewport and status bar are populated across M1–M5. Nothing here is
// reader-visible yet — this milestone ships no feature (see docs/plan-phase1.md).
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__toolbar" data-region="toolbar"></header>
    <!-- Populated only when the open document becomes a dead source (ADR-0004);
         zero-height otherwise, so it is not persistent chrome. -->
    <div class="app-shell__banner" data-region="banner"></div>
    <main class="app-shell__viewport" data-region="viewport"></main>
    <footer class="app-shell__status-bar" data-region="status-bar"></footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--font-mono);
}

.app-shell__toolbar,
.app-shell__status-bar {
  flex: none;
  min-height: 2rem;
}

.app-shell__toolbar {
  border-bottom: 1px solid var(--color-border);
}

.app-shell__status-bar {
  border-top: 1px solid var(--color-border);
}

.app-shell__banner {
  flex: none;
}

.app-shell__viewport {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
</style>
