import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useWorldStore } from '@/stores/world'
import { collectionToArray, type CollectionLike } from '@/utils/foundryCollections'
import type { UserData } from '@/composables/useChatVisibility'
import type { ChatMessageData, ChatMessageView } from '@/composables/useChatMessages'

interface WhisperUserData extends UserData {
  role?: number
}

export interface WhisperTarget {
  key: string
  label: string
  commandTarget?: string
  userIds?: string[]
}

export const PUBLIC_WHISPER_TARGET = 'public'
export const GMS_WHISPER_TARGET = 'gms'
export type WhisperSelectionMode =
  | typeof PUBLIC_WHISPER_TARGET
  | typeof GMS_WHISPER_TARGET
  | 'users'

// Recipient selection for the chat composer: the group targets (everyone /
// GMs), per-user whisper targets built from the world's user list, and the
// `/w target message` command prefixing that Foundry parses server-side.
export function useWhisperTargets() {
  const { t } = useI18n()
  const { world } = storeToRefs(useWorldStore())

  const selectedWhisperMode = ref<WhisperSelectionMode>(PUBLIC_WHISPER_TARGET)
  const selectedWhisperUserKeys = ref(new Set<string>())

  const whisperGroupTargets = computed<WhisperTarget[]>(() => [
    { key: PUBLIC_WHISPER_TARGET, label: t('chat.everyone') },
    { key: GMS_WHISPER_TARGET, label: t('chat.gms'), commandTarget: 'gm' }
  ])

  const whisperUserTargets = computed<WhisperTarget[]>(() => {
    const currentUserId = (world.value as { userId?: string } | undefined)?.userId
    return collectionToArray<WhisperUserData>(world.value?.users as CollectionLike<WhisperUserData>)
      .filter((user) => {
        const id = user._id ?? user.id
        return !!user.name && id !== currentUserId
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .map((user) => ({
        key: `user:${user._id ?? user.id ?? user.name}`,
        label: user.name ?? '',
        commandTarget: `[${user.name}]`,
        userIds: [user._id, user.id].filter((id): id is string => !!id)
      }))
  })

  const selectedWhisperUserTargets = computed(() =>
    whisperUserTargets.value.filter((target) => selectedWhisperUserKeys.value.has(target.key))
  )

  const selectedWhisperCommandTargets = computed(() => {
    if (selectedWhisperMode.value === GMS_WHISPER_TARGET) return ['gm']
    if (selectedWhisperMode.value !== 'users') return []
    return selectedWhisperUserTargets.value
      .map((target) => target.commandTarget)
      .filter((target): target is string => !!target)
  })

  const selectedWhisperLabel = computed(() => {
    if (selectedWhisperMode.value === GMS_WHISPER_TARGET) return t('chat.gms')
    if (selectedWhisperMode.value !== 'users') return t('chat.everyone')
    return selectedWhisperUserTargets.value.map((target) => target.label).join(', ')
  })

  // Group keys arrive from template clicks as plain strings; anything that
  // isn't the GM group falls back to public — the only two groups offered.
  function selectWhisperGroup(key: string) {
    selectedWhisperMode.value =
      key === GMS_WHISPER_TARGET ? GMS_WHISPER_TARGET : PUBLIC_WHISPER_TARGET
    selectedWhisperUserKeys.value = new Set()
  }

  function toggleWhisperUser(key: string) {
    const next = new Set(selectedWhisperUserKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedWhisperUserKeys.value = next
    selectedWhisperMode.value = next.size ? 'users' : PUBLIC_WHISPER_TARGET
  }

  function userTargetSelected(key: string): boolean {
    return selectedWhisperMode.value === 'users' && selectedWhisperUserKeys.value.has(key)
  }

  function messageAuthorIds(message: ChatMessageData): Set<string> {
    const ids = new Set<string>()
    const tablemateOrigin =
      message.flags?.tablemate?.originUserId ?? message['flags.tablemate.originUserId']
    if (typeof tablemateOrigin === 'string' && tablemateOrigin) ids.add(tablemateOrigin)
    if (typeof message.author === 'string' && message.author) ids.add(message.author)
    if (typeof message.author === 'object' && message.author?._id) ids.add(message.author._id)
    if (message.user) ids.add(message.user)
    return ids
  }

  function selectWhisperUserFromMessage(view: ChatMessageView) {
    const authorIds = messageAuthorIds(view.message)
    const nameCandidates = new Set([view.authorName, view.speakerName].filter(Boolean))
    const target = whisperUserTargets.value.find(
      (userTarget) =>
        userTarget.userIds?.some((id) => authorIds.has(id)) || nameCandidates.has(userTarget.label)
    )
    if (!target) return
    selectedWhisperMode.value = 'users'
    selectedWhisperUserKeys.value = new Set([target.key])
  }

  function whisperContent(content: string): string {
    const targets = selectedWhisperCommandTargets.value
    if (!targets.length) return content
    return `/w ${targets.join(', ')} ${content}`
  }

  // Users can leave the world while a whisper selection is open; prune stale
  // keys and fall back to public when the last selected user disappears.
  watch(whisperUserTargets, (targets) => {
    const availableKeys = new Set(targets.map((target) => target.key))
    const next = new Set([...selectedWhisperUserKeys.value].filter((key) => availableKeys.has(key)))
    if (next.size !== selectedWhisperUserKeys.value.size) {
      selectedWhisperUserKeys.value = next
    }
    if (selectedWhisperMode.value === 'users' && !next.size) {
      selectedWhisperMode.value = PUBLIC_WHISPER_TARGET
    }
  })

  return {
    selectedWhisperMode,
    whisperGroupTargets,
    whisperUserTargets,
    selectedWhisperCommandTargets,
    selectedWhisperLabel,
    selectWhisperGroup,
    toggleWhisperUser,
    userTargetSelected,
    selectWhisperUserFromMessage,
    whisperContent
  }
}
