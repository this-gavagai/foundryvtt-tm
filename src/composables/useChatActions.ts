import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import { applyDamage, consumeItem, sendChatMessage } from '@/api/actionRpc'
import type { ApplyDamageMode } from '@/types/api-types'
import type { ChatRollSummary } from '@/utils/chatRollSummary'
import { originItemId, type ChatMessageData } from '@/composables/useChatMessages'

interface ShieldState {
  itemId: Ref<string | null | undefined>
  hp: {
    current: Ref<number | null | undefined>
  }
  hardness: Ref<number | null | undefined>
}

function setHas(setRef: Ref<Set<string>>, key: string): boolean {
  return setRef.value.has(key)
}

function setPending(setRef: Ref<Set<string>>, key: string, pending: boolean) {
  const next = new Set(setRef.value)
  if (pending) next.add(key)
  else next.delete(key)
  setRef.value = next
}

function damageActionKey(message: ChatMessageData, rollIndex: number): string | undefined {
  if (!message._id) return undefined
  return `${message._id}:${rollIndex}`
}

function consumeActionKey(message: ChatMessageData): string | undefined {
  return message._id ?? undefined
}

export function useChatActions({
  actorId,
  actor,
  shield,
  messages,
  messageIsOwnActor,
  onMessageSent
}: {
  actorId: Ref<string | null | undefined>
  actor: Ref<CharacterPF2e | null | undefined>
  shield: ShieldState
  messages: ComputedRef<ChatMessageData[]>
  messageIsOwnActor: (message: ChatMessageData) => boolean
  onMessageSent?: () => void
}) {
  const draft = ref('')
  const isSending = ref(false)
  const sendError = ref(false)
  const actionError = ref(false)
  const pendingDamageActions = ref(new Set<string>())
  const pendingConsumeMessages = ref(new Set<string>())

  const canSend = computed(
    () => !!actorId.value && draft.value.trim().length > 0 && !isSending.value
  )

  function canApplyDamage(roll: ChatRollSummary): boolean {
    return roll.className === 'DamageRoll' && roll.total !== undefined && !!actor.value
  }

  function canShieldBlock(): boolean {
    return (
      !!shield.itemId.value &&
      (shield.hp.current.value ?? 0) > 0 &&
      (shield.hardness.value ?? 0) > 0
    )
  }

  function isDamageActionPending(message: ChatMessageData, rollIndex: number): boolean {
    const key = damageActionKey(message, rollIndex)
    return !!key && setHas(pendingDamageActions, key)
  }

  function canTriggerDamageAction(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ApplyDamageMode
  ): boolean {
    if (!canApplyDamage(roll)) return false
    if (mode === 'block' && !canShieldBlock()) return false
    const key = damageActionKey(message, rollIndex)
    return !!key && !setHas(pendingDamageActions, key)
  }

  async function applyDamageRoll(
    message: ChatMessageData,
    roll: ChatRollSummary,
    rollIndex: number,
    mode: ApplyDamageMode
  ) {
    if (!canTriggerDamageAction(message, roll, rollIndex, mode)) return
    const key = damageActionKey(message, rollIndex)
    if (!key || !message._id || !actor.value) return

    actionError.value = false
    setPending(pendingDamageActions, key, true)
    try {
      await applyDamage(actor as Ref<CharacterPF2e>, message._id, mode, rollIndex)
    } catch {
      actionError.value = true
    } finally {
      setPending(pendingDamageActions, key, false)
    }
  }

  async function handleCardButtonClick(event: MouseEvent) {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.card-buttons button[data-action="consume"]'
    )
    if (!btn) return
    event.preventDefault()
    event.stopPropagation()
    const msgEl = btn.closest<HTMLElement>('[data-message-id]')
    const message = messages.value.find((m) => m._id === msgEl?.dataset.messageId)
    if (!message || !messageIsOwnActor(message) || !actor.value) return
    const itemId = originItemId(message)
    if (!itemId) return
    const key = consumeActionKey(message)
    if (!key || setHas(pendingConsumeMessages, key)) return

    actionError.value = false
    setPending(pendingConsumeMessages, key, true)
    btn.disabled = true
    btn.setAttribute('aria-busy', 'true')
    try {
      await consumeItem(actor as Ref<CharacterPF2e>, itemId)
    } catch {
      actionError.value = true
    } finally {
      setPending(pendingConsumeMessages, key, false)
      btn.disabled = false
      btn.removeAttribute('aria-busy')
    }
  }

  async function submitMessage() {
    const content = draft.value.trim()
    if (!content || !actorId.value || isSending.value) return

    isSending.value = true
    sendError.value = false
    try {
      await sendChatMessage(actorId.value, content)
      draft.value = ''
      onMessageSent?.()
    } catch {
      sendError.value = true
    } finally {
      isSending.value = false
    }
  }

  return {
    draft,
    isSending,
    sendError,
    actionError,
    canSend,
    canApplyDamage,
    isDamageActionPending,
    canTriggerDamageAction,
    applyDamageRoll,
    handleCardButtonClick,
    submitMessage
  }
}
