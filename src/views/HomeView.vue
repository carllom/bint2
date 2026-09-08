<script setup lang="ts">
// Phase-1 app shell, extended for phase 1.5. The toolbar carries the file-open
// and bytes-per-row controls; the viewport carries the hex grid; the Inspector
// Panel (#54) docks to the viewport's bottom or right edge; the status bar reads
// out where the Cursor is (#23); the dead-source banner (#26) surfaces above the
// viewport when the open document's source latches or repeatedly fails (ADR-0004).
import BytesPerRowControl from '@/components/BytesPerRowControl.vue'
import DeadSourceBanner from '@/components/DeadSourceBanner.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import HexViewer from '@/components/HexViewer.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import { usePreferencesStore } from '@/stores/preferences'

// Only for the layout: which edge the Inspector docks to (plan §3.1). The Panel
// itself sits in DOM order between the viewport and the status bar whatever the
// value, so tab order stays viewport → inspector → status bar (plan §3.7); this
// attribute only drives whether it renders as a bottom strip or a right column.
const preferences = usePreferencesStore()
</script>

<template>
  <div class="app-shell" :data-inspector-dock="preferences.dock">
    <header class="app-shell__toolbar" data-region="toolbar">
      <FileDropZone />
      <BytesPerRowControl />
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
           (plan §3.1). Between the viewport and the status bar in DOM order. -->
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

/* Viewport + Inspector share the space between banner and status bar. Bottom
   dock stacks them (Inspector below); right dock lays them side by side
   (Inspector to the right). The Inspector is `flex: none` either way. */
.app-shell__content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-shell[data-inspector-dock='right'] .app-shell__content {
  flex-direction: row;
}

.app-shell__viewport {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
