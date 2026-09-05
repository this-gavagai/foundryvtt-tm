// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { TablemateActorRef } from '@/types/character-types'

// The hit-point modal's one-tap shortcut for the hit you just took. It is a
// subset of the chat roll card, so the rules it has to hold are the ones that
// keep the two agreeing about the SAME roll: which message the offer is about,
// which direction it applies, and whether it may be offered at all.

const applyDamage = vi.fn(() => Promise.resolve(null))
vi.mock('@/api/actionRpc', () => ({
  applyDamage: (...a: unknown[]) => applyDamage(...(a as []))
}))

const { useLastDamage } = await import('@/composables/useLastDamage')
const { useWorldStore } = await import('@/stores/world')
const { useUserStore } = await import('@/stores/user')
const { useListenersStore } = await import('@/stores/listenersOnline')

const ME = 'user-me'
const GM = 'user-gm'

// A PF2e damage roll as it arrives on the wire: a JSON string on the message.
// `healing` rides as a kind on the term, which is the ONLY thing separating a
// Heal spell from a greataxe — both are class DamageRoll.
function damageRoll(total: number, healing = false): string {
  return JSON.stringify({
    class: 'DamageRoll',
    total,
    terms: [
      {
        class: 'Die',
        number: 1,
        faces: 8,
        results: [{ result: total, active: true }],
        ...(healing ? { options: { kinds: ['healing'] } } : {})
      }
    ]
  })
}

function checkRoll(total: number): string {
  return JSON.stringify({ class: 'CheckRoll', total, terms: [] })
}

interface MessageSpec {
  id: string
  at: number
  rolls?: string[]
  author?: string
  whisper?: string[]
}

function seedWorld(specs: MessageSpec[]): void {
  useUserStore().userId = ME
  useWorldStore().world = {
    userId: ME,
    users: [
      { _id: ME, name: 'Me', flags: {} },
      { _id: GM, name: 'GM', role: 4, flags: {} }
    ],
    messages: specs.map((spec) => ({
      _id: spec.id,
      timestamp: spec.at,
      author: spec.author ?? GM,
      rolls: spec.rolls,
      whisper: spec.whisper,
      flags: {}
    })),
    settings: []
  } as never
}

const actor = ref({ _id: 'seelah' }) as TablemateActorRef
const gmListening = () => useListenersStore().addListener('gm-client')

beforeEach(() => {
  setActivePinia(createPinia())
  applyDamage.mockClear()
})

describe('the last-damage offer', () => {
  it('survives chatter landing on top of the roll', () => {
    // The whole reason this is not "read the newest message": someone typing
    // "ouch" between the GM's roll and the player's tap used to erase the offer.
    seedWorld([
      { id: 'hit', at: 100, rolls: [damageRoll(12)] },
      { id: 'ouch', at: 101 },
      { id: 'nice', at: 102 }
    ])
    gmListening()
    const { offer, label } = useLastDamage(actor)
    expect(offer.value?.messageId).toBe('hit')
    expect(label.value).toBe('-12')
  })

  it('does not reach past the lookback window', () => {
    // A roll from a previous fight is not the hit you just took.
    seedWorld([
      { id: 'hit', at: 1, rolls: [damageRoll(12)] },
      ...Array.from({ length: 25 }, (_, i) => ({ id: `chat-${i}`, at: 10 + i }))
    ])
    gmListening()
    expect(useLastDamage(actor).offer.value).toBeUndefined()
  })

  it('takes the newest damage roll, not the first one it can find', () => {
    seedWorld([
      { id: 'old-hit', at: 100, rolls: [damageRoll(4)] },
      { id: 'new-hit', at: 101, rolls: [damageRoll(9)] }
    ])
    gmListening()
    expect(useLastDamage(actor).offer.value?.messageId).toBe('new-hit')
  })

  it('ignores rolls that are not damage', () => {
    seedWorld([
      { id: 'hit', at: 100, rolls: [damageRoll(12)] },
      { id: 'check', at: 101, rolls: [checkRoll(18)] }
    ])
    gmListening()
    // The check is skipped over rather than ending the search.
    expect(useLastDamage(actor).offer.value?.messageId).toBe('hit')
  })

  // A Heal spell is class DamageRoll like everything else. Applied with mode
  // 'damage' PF2e reads its positive total and takes the hit points OFF, so the
  // direction has to come from the roll and not from which button was drawn.
  it('offers healing as healing', async () => {
    seedWorld([{ id: 'heal', at: 100, rolls: [damageRoll(8, true)] }])
    gmListening()
    const { offer, label, color, applyLastDamage } = useLastDamage(actor)
    expect(offer.value?.isHealing).toBe(true)
    expect(label.value).toBe('+8')
    expect(color.value).toBe('green')
    await applyLastDamage()
    expect(applyDamage).toHaveBeenCalledWith(actor, 'heal', 'heal', 0)
  })

  it('applies a damage roll as damage, by message and roll index', async () => {
    seedWorld([{ id: 'hit', at: 100, rolls: [damageRoll(12)] }])
    gmListening()
    const { color, applyLastDamage } = useLastDamage(actor)
    expect(color.value).toBe('red')
    await applyLastDamage()
    // Roll index 0 — the same roll the label was read from.
    expect(applyDamage).toHaveBeenCalledWith(actor, 'hit', 'damage', 0)
  })

  // Damage this client rolled is damage it DEALT. Offering to apply it in the
  // roller's own hit-point modal is a destructive tap with no undo behind it.
  it('withholds damage this client rolled itself', () => {
    seedWorld([{ id: 'my-strike', at: 100, rolls: [damageRoll(18)], author: ME }])
    gmListening()
    expect(useLastDamage(actor).offer.value).toBeUndefined()
  })

  it('still offers healing this client rolled itself', () => {
    seedWorld([{ id: 'my-heal', at: 100, rolls: [damageRoll(8, true)], author: ME }])
    gmListening()
    expect(useLastDamage(actor).offer.value?.messageId).toBe('my-heal')
  })

  // The GM's private roll is in the payload but not for this player to read —
  // the same rule the overlay and the unread badge already apply.
  it('cannot see a whisper this client is not party to', () => {
    seedWorld([
      { id: 'hit', at: 100, rolls: [damageRoll(12)] },
      { id: 'secret', at: 101, rolls: [damageRoll(99)], whisper: [GM] }
    ])
    gmListening()
    expect(useLastDamage(actor).offer.value?.messageId).toBe('hit')
  })

  // applyDamage is an RPC with no direct-write half: PF2e's IWR pass runs on
  // the GM's client, so with nobody listening the tap can only be swallowed.
  it('is withheld with no GM listening', () => {
    seedWorld([{ id: 'hit', at: 100, rolls: [damageRoll(12)] }])
    const { offer, canApply } = useLastDamage(actor)
    expect(offer.value?.messageId).toBe('hit')
    expect(canApply.value).toBe(false)
  })

  it('sends nothing when it cannot be applied', async () => {
    seedWorld([{ id: 'hit', at: 100, rolls: [damageRoll(12)] }])
    await useLastDamage(actor).applyLastDamage()
    expect(applyDamage).not.toHaveBeenCalled()
  })
})
