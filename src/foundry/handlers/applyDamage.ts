import type { CharacterPF2e } from '@7h3laughingman/pf2e-types'
import type { ApplyDamageArgs } from '@/types/api-types'
import { getGame, getCharacter, makeAck } from '../utils/foundry'

type DamageRollLike = {
  total: number
  alter?: (
    multiplier: number,
    addend: number,
    options?: { multiplyNumeric?: boolean }
  ) => DamageRollLike
  toJSON?: () => unknown
  constructor: {
    fromData?: (data: unknown) => DamageRollLike
  }
}

function cloneDamageRoll(roll: DamageRollLike): DamageRollLike | undefined {
  if (typeof roll.toJSON !== 'function' || typeof roll.constructor.fromData !== 'function') {
    return undefined
  }
  return roll.constructor.fromData(roll.toJSON())
}

function alteredDamageRoll(roll: DamageRollLike, multiplier: number): DamageRollLike | number {
  const cloned = cloneDamageRoll(roll)
  if (cloned?.alter) return cloned.alter(multiplier, 0, { multiplyNumeric: true })
  return Math.floor(Math.abs(roll.total) * Math.abs(multiplier))
}

// A token of the actor TAKING the damage, which PF2e requires (ApplyDamageParams
// declares it non-optional — it drives shield-block resolution, the IWR context,
// and the damage-taken card).
//
// Deliberately not the chat message's own token: the message is the damage
// SOURCE, so its speaker is whoever dealt the damage, not who is applying it.
//
// getActiveTokens alone is not enough. It reads `canvas.scene` — only the scene
// this client currently has DRAWN — and returns nothing at all when
// `canvas.ready` is false. On the elected GM's client that made "apply damage"
// fail whenever the GM happened to be looking at another scene, or had no scene
// up, which has nothing to do with the player who tapped the button. So fall back
// to the actor's dependent tokens, which core tracks across every scene.
//
// Order: the drawn scene first, so a shield-block prompt and the token HUD change
// happen where the GM can see them; linked before unlinked, matching what PF2e's
// own sheet picks. Which token among several equally-good ones stays arbitrary —
// it was before, and the request carries nothing to disambiguate with.
// getActiveTokens is overloaded (Token vs TokenDocument by its `document` flag),
// so the type comes from getDependentTokens, which has one signature and returns
// the documents applyDamage wants.
type RecipientToken = ReturnType<CharacterPF2e['getDependentTokens']>[number]

function recipientToken(actor: CharacterPF2e): RecipientToken | undefined {
  const drawn = actor.getActiveTokens(true, true)[0] ?? actor.getActiveTokens(false, true)[0]
  if (drawn) return drawn

  const dependents = actor.getDependentTokens()
  return dependents.find((token) => token.actorLink) ?? dependents[0]
}

export async function foundryApplyDamage(args: ApplyDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  // Failures throw: the dispatch's central catch turns them into error acks,
  // so the app shows "action failed" instead of a tap that silently did nothing.
  const message = source.messages.get(args.messageId)
  if (!message) throw new Error(`Chat message ${args.messageId} not found`)

  const rollIndex = args.rollIndex ?? 0
  const roll = message.rolls?.[rollIndex] as DamageRollLike | undefined
  if (!roll || typeof roll.total !== 'number') {
    throw new Error(`No damage roll at index ${rollIndex}`)
  }

  const token = recipientToken(actor)
  if (!token) throw new Error(`${actor.name} has no token on any scene`)

  switch (args.mode) {
    case 'half':
      await actor.applyDamage({ damage: alteredDamageRoll(roll, 0.5) as never, token })
      break
    case 'double':
      await actor.applyDamage({ damage: alteredDamageRoll(roll, 2) as never, token })
      break
    case 'heal':
      // PF2e treats negative scalar damage as healing.
      await actor.applyDamage({ damage: -Math.floor(Math.abs(roll.total)), token })
      break
    case 'block':
      await actor.applyDamage({ damage: roll as never, token, shieldBlockRequest: true })
      break
    case 'damage':
    default:
      // Pass the Rolled<DamageRoll> directly so PF2e can apply per-type IWR.
      await actor.applyDamage({ damage: roll as never, token })
      break
  }

  return makeAck(args)
}
