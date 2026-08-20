<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSharedImage } from '@/composables/useSharedImage'
import { getMediaPath } from '@/utils/utilities'
import ModalBox from './ModalBox.vue'

// Pops the image a GM shared from Foundry ("show players"). Mounted once at the
// app root; the payload arrives through the socket wiring, which already gates
// on the opt-in setting, so anything reaching here is meant to be shown.
const { sharedImage, dismissSharedImage } = useSharedImage()

const modalRef = ref<InstanceType<typeof ModalBox>>()

// Not routed through the image cache: shared art is full-size and usually seen
// once, so it would evict the icon-sized entries the sheet reuses constantly.
const src = computed(() => (sharedImage.value ? getMediaPath(sharedImage.value.image) : ''))
// Foundry sends '' for an untitled share; undefined leaves the header blank
// rather than rendering an empty title row.
const title = computed(() => sharedImage.value?.title?.trim() || undefined)
const caption = computed(() => sharedImage.value?.caption?.trim() ?? '')

// State-driven rather than an imperative open() from the wiring: the socket
// layer never holds a component ref. A second share while one is open swaps the
// payload and re-opens (already-open is a no-op inside ModalBox).
watch(sharedImage, (payload) => {
  if (payload) modalRef.value?.open()
  else modalRef.value?.close()
})

// The dialog's own dismissals (backdrop, escape, X) only flip ModalBox's state,
// so mirror them back — otherwise the payload would linger and re-sharing the
// same image would look like nothing happened.
watch(
  () => modalRef.value?.isOpen,
  (open) => {
    if (open === false && sharedImage.value) dismissSharedImage()
  }
)
</script>
<template>
  <Teleport to="#modals">
    <ModalBox ref="modalRef" :title="title" panelClass="w-full max-w-3xl">
      <div data-component="SharedImage" class="mt-2 flex flex-col items-center gap-2">
        <img
          v-if="src"
          :src="src"
          :alt="title ?? ''"
          data-part="shared-image"
          class="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
          decoding="async"
        />
        <p v-if="caption" data-part="shared-image-caption" class="text-center text-base">
          {{ caption }}
        </p>
      </div>
    </ModalBox>
  </Teleport>
</template>
