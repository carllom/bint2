<script setup lang="ts">
// Phase-1 app shell, extended for phase 1.5. The toolbar carries the file-open
// and bytes-per-row controls; the viewport carries the hex grid; the Inspector
// Panel (#54) sits between the viewport and the status bar; the status bar reads
// out where the Cursor is (#23); the dead-source banner (#26) surfaces above the
// viewport when the open document's source latches or repeatedly fails (ADR-0004).
//
// Phase 1.75: the Inspector's bottom/right dock is gone (plan-phase1.75.md §3.4,
// §3.5). The resizable Sidebar / accordion that will house the Panel is #80's.
import ByteOrderControl from '@/components/ByteOrderControl.vue'
import BytesPerRowControl from '@/components/BytesPerRowControl.vue'
import CodePageControl from '@/components/CodePageControl.vue'
import DeadSourceBanner from '@/components/DeadSourceBanner.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import HexViewer from '@/components/HexViewer.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
</script>

<template>
  <div class="app-shell">
    <header class="app-shell__toolbar" data-region="toolbar">
      <FileDropZone />
      <BytesPerRowControl />
      <ByteOrderControl />
      <CodePageControl />
    </header>
    <!-- Populated only when the open document becomes a dead source (ADR-0004);
         zero-height otherwise, so it is not persistent chrome. -->
    <div class="app-shell__banner" data-region="banner">
      <DeadSourceBanner />
    </div>
    <div class="app-shell__content">
      <main class="app-shell__viewport" data-region="viewport">
        <HexViewer />
      </main>
      <!-- Visible whenever a document is open, hidden entirely when none is
           (plan §3.1). Between the viewport and the status bar in DOM order,
           so tab order stays viewport → inspector → status bar (plan §3.7). -->
      <InspectorPanel />
    </div>
    <!-- Packed and glanceable, never a live region (#23, ADR-0005). -->
    <footer class="app-shell__status-bar" data-region="status-bar">
      <StatusBar />
    </footer>
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

/* Viewport + Inspector share the space between banner and status bar, stacked
   with the Inspector below. The Inspector is `flex: none`. */
.app-shell__content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-shell__viewport {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
