<script setup lang="ts">
// Phase-1 app shell, rebuilt for phase 1.75 (plan-phase1.75.md §3, ADR-0010).
// The toolbar carries the file-open and view controls; below it the content
// area is a horizontal Reka `SplitterGroup` — the **hex grid** (flex) ‖ a
// draggable **splitter handle** ‖ the resizable **Sidebar** (right). The
// Sidebar is one multi-open accordion of **Panels**: the **Inspector**, then
// the **Bitmap** (a shell here — its canvas is M5). The status bar reads out
// where the Cursor is (#23); the dead-source banner (#26) surfaces above the
// content when the open document's source latches or repeatedly fails
// (ADR-0004).
//
// The phase-1.5 bottom/right Inspector dock is gone (§3.4, §3.5). Sidebar width
// and collapse, and each Panel's open state, persist through the Pinia
// `preferences` store — one owner, one storage key, never Reka's `auto-save-id`
// (ADR-0009 §5).
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import ByteOrderControl from '@/components/ByteOrderControl.vue'
import BytesPerRowControl from '@/components/BytesPerRowControl.vue'
import CodePageControl from '@/components/CodePageControl.vue'
import DeadSourceBanner from '@/components/DeadSourceBanner.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import HexViewer from '@/components/HexViewer.vue'
import InspectorPanel from '@/components/InspectorPanel.vue'
import BitmapPanel from '@/components/BitmapPanel.vue'
import SearchResultsPanel from '@/components/SearchResultsPanel.vue'
import StatusBar from '@/components/StatusBar.vue'
import AccordionRoot from '@/components/shell/AccordionRoot.vue'
import AccordionItem from '@/components/shell/AccordionItem.vue'
import AccordionTrigger from '@/components/shell/AccordionTrigger.vue'
import AccordionContent from '@/components/shell/AccordionContent.vue'
import SplitterGroup from '@/components/shell/SplitterGroup.vue'
import SplitterPanel, { type SplitterPanelHandle } from '@/components/shell/SplitterPanel.vue'
import SplitterResizeHandle from '@/components/shell/SplitterResizeHandle.vue'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'
import { DEFAULT_SIDEBAR_WIDTH, SIDEBAR_MIN_PX, sidebarMaxSize } from './sidebarLayout'

const documentStore = useDocumentStore()
const preferences = usePreferencesStore()

/** The Sidebar exists only while a document is open (plan §3.1, ADR-0010). */
const hasDocument = computed(() => documentStore.source !== null)

// The split container's own width, watched so the grid's dynamic minimum can be
// subtracted from it for the Sidebar's `max-size` (plan §3.2). Zero until
// measured (and in a layout-free test DOM) — `sidebarMaxSize` floors at 200.
const contentEl = useTemplateRef<HTMLElement>('content')
const containerWidth = ref(0)

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const el = contentEl.value
  if (el === null) {
    return
  }
  containerWidth.value = el.getBoundingClientRect().width
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0
    if (width > 0) {
      containerWidth.value = width
    }
  })
  resizeObserver.observe(el)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/**
 * The Sidebar splitter panel's `max-size` (plan §3.2): container width less the
 * grid's current minimum (which tracks `bytesPerRow`), never below the 200 px
 * Sidebar floor. Only bounds the *handle* — a too-narrow window makes the grid
 * yield under `overflow: hidden` instead.
 */
const sidebarMax = computed(() => sidebarMaxSize(containerWidth.value, documentStore.bytesPerRow))

/**
 * The accordion's open set, bridged to the two persisted Panel-open booleans
 * (plan §3.1). `v-model` in, store setters out — toggling a section round-trips
 * through the store and back to this computed.
 */
const openSections = computed<string[]>(() => {
  const open: string[] = []
  if (preferences.inspectorOpen) {
    open.push('inspector')
  }
  if (preferences.bitmapOpen) {
    open.push('bitmap')
  }
  if (preferences.searchResultsOpen) {
    open.push('search-results')
  }
  return open
})

function onSectionsChange(values: string[]): void {
  const inspector = values.includes('inspector')
  const bitmap = values.includes('bitmap')
  const searchResults = values.includes('search-results')
  if (inspector !== preferences.inspectorOpen) {
    preferences.setInspectorOpen(inspector)
  }
  if (bitmap !== preferences.bitmapOpen) {
    preferences.setBitmapOpen(bitmap)
  }
  if (searchResults !== preferences.searchResultsOpen) {
    preferences.setSearchResultsOpen(searchResults)
  }
}

const sidebarPanel = useTemplateRef<SplitterPanelHandle>('sidebarPanel')

/**
 * A committed Sidebar width from a drag, the APG arrow keys, or Home/End
 * (min/max) — all persist through here (plan §3.2). Only the `resize(0)` that
 * rides along with a collapse is skipped; the width to expand back to must
 * survive it (§3.3).
 */
function onSidebarResize(size: number): void {
  if (size < 1) {
    return
  }
  const px = Math.round(size)
  if (px !== preferences.sidebarWidth) {
    preferences.setSidebarWidth(px)
  }
}

function onSidebarCollapse(): void {
  preferences.setSidebarCollapsed(true)
}

function onSidebarExpand(): void {
  preferences.setSidebarCollapsed(false)
}

/** Double-click the handle → back to the default width (plan §3.2) — wrapper-added. */
function onHandleReset(): void {
  preferences.setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  sidebarPanel.value?.resize(DEFAULT_SIDEBAR_WIDTH)
}
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
    <div ref="content" class="app-shell__content">
      <SplitterGroup direction="horizontal">
        <!-- The hex grid keeps the flex remainder of the width (plan §3.1). Its
             panel's `overflow: hidden` is the "grid yields / clips" behaviour
             when the window is too narrow for grid + Sidebar. -->
        <SplitterPanel :order="1">
          <main class="app-shell__viewport" data-region="viewport">
            <HexViewer />
          </main>
        </SplitterPanel>

        <template v-if="hasDocument">
          <!-- The handle is also the whole-Sidebar collapse / restore
               affordance (plan §3.3); Enter toggles collapse (APG). -->
          <SplitterResizeHandle @dblclick="onHandleReset" />
          <SplitterPanel
            ref="sidebarPanel"
            :order="2"
            size-unit="px"
            :min-size="SIDEBAR_MIN_PX"
            :max-size="sidebarMax"
            :default-size="preferences.sidebarCollapsed ? 0 : preferences.sidebarWidth"
            collapsible
            :collapsed-size="0"
            @resize="onSidebarResize"
            @collapse="onSidebarCollapse"
            @expand="onSidebarExpand"
          >
            <!-- The stack renders at natural height; the whole Sidebar scrolls
                 if it overflows — sections get no scrollbar of their own. -->
            <div class="app-shell__sidebar" data-region="sidebar">
              <AccordionRoot
                :model-value="openSections"
                :unmount-on-hide="true"
                @update:model-value="onSectionsChange"
              >
                <AccordionItem value="inspector">
                  <AccordionTrigger>Inspector</AccordionTrigger>
                  <AccordionContent>
                    <InspectorPanel />
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="bitmap">
                  <AccordionTrigger>Bitmap</AccordionTrigger>
                  <AccordionContent>
                    <BitmapPanel />
                  </AccordionContent>
                </AccordionItem>
                <!-- Entropy (#107) slots in here, before Search results, once
                     it ships — CONTEXT.md's fixed Panel order is Inspector,
                     Bitmap, Entropy, Search results. -->
                <AccordionItem value="search-results">
                  <AccordionTrigger>Search results</AccordionTrigger>
                  <AccordionContent>
                    <SearchResultsPanel />
                  </AccordionContent>
                </AccordionItem>
              </AccordionRoot>
            </div>
          </SplitterPanel>
        </template>
      </SplitterGroup>
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

/* The grid ‖ Sidebar split fills the space between banner and status bar. */
.app-shell__content {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}

.app-shell__viewport {
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

/* The Sidebar column: full height, scrolls as a whole (plan §3.1). The width is
   the splitter panel's; this element just fills it. The left border is the seam
   against the handle. */
.app-shell__sidebar {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg);
}
</style>
