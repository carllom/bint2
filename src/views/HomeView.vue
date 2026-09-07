<script setup lang="ts">
// Phase-1 app shell. The toolbar carries the file-open control and the viewport
// carries the hex grid; the dead-source banner and status bar are populated at
// M5 (see docs/plan-phase1.md).
import BytesPerRowControl from '@/components/BytesPerRowControl.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import HexViewer from '@/components/HexViewer.vue'
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__toolbar" data-region="toolbar">
      <FileDropZone />
      <BytesPerRowControl />
    </header>
    <!-- Populated only when the open document becomes a dead source (ADR-0004);
         zero-height otherwise, so it is not persistent chrome. -->
    <div class="app-shell__banner" data-region="banner"></div>
    <main class="app-shell__viewport" data-region="viewport">
      <HexViewer />
    </main>
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
  display: flex;
  align-items: center;
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
