import type { ApplyDamageArgs, ApplyDamageMode } from '@/types/api-types'
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

export async function foundryApplyDamage(args: ApplyDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  const message = source.messages.get(args.messageId)
  if (!message) return makeAck(args)

  const rollIndex = args.rollIndex ?? 0
  const roll = message.rolls?.[rollIndex] as DamageRollLike | undefined
  if (!roll || typeof roll.total !== 'number') return makeAck(args)

  const token = actor.getActiveTokens(true, true)[0]
  if (!token) return makeAck(args)

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
