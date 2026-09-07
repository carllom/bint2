<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document'

// The one surface a dead source gets (#26, ADR-0004): persistent and
// non-dismissible — opening another document is the only reset, handled by
// the store's `open`. It never touches the Viewport underneath, which keeps
// painting whatever bytes it already had. `role="alert"` announces it in
// place without stealing focus (ADR-0005); there is nothing to focus, since
// there is nothing to dismiss.

const documentStore = useDocumentStore()

const message = computed(() => {
  const name = documentStore.fileName
  switch (documentStore.sourceHealth) {
    case 'gone':
      return `“${name}” is no longer available. The bytes shown are the last ones read.`
    case 'failing':
      return `“${name}” could not be read. The bytes shown are the last ones read.`
    default:
      return null
  }
})
</script>

<template>
  <div
    v-if="message !== null"
    class="dead-source-banner"
    role="alert"
    data-field="dead-source-banner"
  >
    {{ message }}
  </div>
</template>

<style scoped>
.dead-source-banner {
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-cursor);
  font-family: var(--font-mono);
}
</style>
