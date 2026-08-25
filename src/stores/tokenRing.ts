import { ref } from 'vue'
import { defineStore } from 'pinia'

// Which dynamic token ring the world is using, piggybacked on the module's
// LISTENER_ONLINE announcement (see foundry/listener.ts).
//
// The world's `core.dynamicTokenRing` setting does reach the app in the world
// payload, but it holds only a ring ID — and modules register their own rings
// (an adventure path shipping themed rings is common), so an ID alone can't be
// resolved to a spritesheet without the ring registry that lives in the Foundry
// client. The module reports the already-resolved path instead, which covers
// custom rings for free.
export const useTokenRingStore = defineStore('tokenRing', () => {
  // Undefined until a module announces itself, and on modules predating the
  // field — in which case avatars simply render without rings.
  const spritesheet = ref<string | undefined>(undefined)

  function reportSpritesheet(path: string | undefined) {
    spritesheet.value = path || undefined
  }

  return { spritesheet, reportSpritesheet }
})
