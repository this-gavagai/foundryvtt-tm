// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessageData } from '@/composables/useChatMessages'
import type { ChatRollSummary } from '@/utils/chatRollSummary'

// Every action on a roll card is an RPC: PF2e applies the damage through its own
// IWR pass, spends the hero point, rewrites the spell card. None of it can
// happen with no GM client listening.
//
// Offered anyway, these read as live buttons that swallow a tap and report
// nothing for the full 30-second ack timeout — which a player reads as a broken
// button rather than as an absent GM. The rest of the sheet already answers this
// question (roll chits vanish, End Turn greys out); these did not.

const applyDamage = vi.fn(() => Promise.resolve(null))
const rerollChatRoll = vi.fn(() => Promise.resolve(null))
const consumeItem = vi.fn(() => Promise.resolve(null))
const selectSpellVariant = vi.fn(() => Promise.resolve(null))

vi.mock('@/api/actionRpc', () => ({
  applyDamage: (...a: unknown[]) => applyDamage(...(a as [])),
  consumeItem: (...a: unknown[]) => consumeItem(...(a as [])),
  rerollChatRoll: (...a: unknown[]) => rerollChatRoll(...(a as [])),
  selectSpellVariant: (...a: unknown[]) => selectSpellVariant(...(a as [])),
  sendImage: vi.fn(),
  sendVoiceMemo: vi.fn()
}))
vi.mock('@/api/documents', () => ({
  modifyDocument: vi.fn(async () => ({ result: [] })),
  updateUserFlag: vi.fn(async () => undefined)
}))
vi.mock('@/composables/useHapticFeedback', () => ({ triggerLightHapticFeedback: vi.fn() }))

const { useChatActions } = await import('@/composables/useChatActions')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')
const { useListenersStore } = await import('@/stores/listenersOnline')

const message = { _id: 'msg-1', flags: {}, speaker: { actor: 'seelah-id' } } as ChatMessageData

const damageRoll: ChatRollSummary = {
  className: 'DamageRoll',
  total: 7,
  flavors: [],
  dice: [],
  isHealing: false
}
const checkRoll: ChatRollSummary = {
  className: 'CheckRoll',
  total: 18,
  flavors: [],
  dice: [],
  isHealing: false
}

function makeActions() {
  useWorldStore().world = {
    messages: [message],
    users: [{ _id: 'me', name: 'Me', flags: {} }],
    settings: []
  } as never
  return useChatActions({
    actorId: ref('seelah-id'),
    // A character with a hero point to spend, so `canReroll` is only ever
    // withheld for the reason under test.
    actor: ref({
      _id: 'seelah-id',
      system: { resources: { heroPoints: { value: 1 } } }
    }) as never,
    messages: computed<ChatMessageData[]>(() => [message]),
    messageIsOwnActor: () => true
  })
}

const gmListening = () => useListenersStore().addListener('gm-client')

// One of PF2e's own card buttons, in the DOM shape handleCardButtonClick looks
// for: a `data-action` button inside `.card-buttons`, inside the message row.
function cardButton(action: 'consume' | 'spell-variant') {
  const row = document.createElement('div')
  row.dataset.messageId = 'msg-1'
  const buttons = document.createElement('div')
  buttons.className = 'card-buttons'
  const button = document.createElement('button')
  button.dataset.action = action
  buttons.append(button)
  row.append(buttons)
  document.body.append(row)
  return { button, event: { target: button, preventDefault() {}, stopPropagation() {} } as never }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('__APP_VERSION__', '0.0.0-test')
  setActivePinia(createPinia())
  useUserStore().setUserId('me')
})

describe('with a GM listening', () => {
  beforeEach(gmListening)

  it('offers apply-damage and reroll', () => {
    const actions = makeActions()
    expect(actions.canApplyDamage(damageRoll)).toBe(true)
    expect(actions.canReroll(message, checkRoll)).toBe(true)
    expect(actions.canTriggerDamageAction(message, damageRoll, 0, 'damage')).toBe(true)
    expect(actions.canTriggerRollAction(message, checkRoll, 0, 'hero-point')).toBe(true)
  })
})

describe('with no GM listening', () => {
  it('withholds apply-damage', () => {
    const actions = makeActions()
    expect(actions.canApplyDamage(damageRoll)).toBe(false)
    expect(actions.canTriggerDamageAction(message, damageRoll, 0, 'damage')).toBe(false)
  })

  it('withholds reroll', () => {
    const actions = makeActions()
    expect(actions.canReroll(message, checkRoll)).toBe(false)
    expect(actions.canTriggerRollAction(message, checkRoll, 0, 'hero-point')).toBe(false)
  })

  // The buttons on a spell or consumable card are PF2e's own HTML inside the
  // message, so there is nothing to hide — the tap has to be refused where it
  // arrives, and reported, rather than spend the ack timeout.
  it('refuses a card button and reports it, without sending anything', async () => {
    const actions = makeActions()
    const { button, event } = cardButton('spell-variant')

    await actions.handleCardButtonClick(event)

    expect(selectSpellVariant).not.toHaveBeenCalled()
    expect(consumeItem).not.toHaveBeenCalled()
    expect(actions.actionError.value).toBe(true)
    // The card's own button is left as it was, not stuck in aria-busy.
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-busy')).toBeNull()
  })

  it('runs the same tap once a GM is there', async () => {
    const actions = makeActions()
    gmListening()
    const { event } = cardButton('spell-variant')

    await actions.handleCardButtonClick(event)

    expect(selectSpellVariant).toHaveBeenCalledTimes(1)
    expect(actions.actionError.value).toBe(false)
  })
})
