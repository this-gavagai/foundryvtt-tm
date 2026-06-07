import type { ApplyDamageArgs } from '@/types/api-types'
import { getGame, getCharacter, makeAck } from '../utils/foundry'

export async function foundryApplyDamage(args: ApplyDamageArgs) {
  const source = getGame()
  const actor = getCharacter(source, args.characterId)

  const message = source.messages.get(args.messageId)
  if (!message) return makeAck(args)

  const rollIndex = args.rollIndex ?? 0
  const roll = message.rolls?.[rollIndex] as { total: number } | undefined
  if (!roll || typeof roll.total !== 'number') return makeAck(args)

  const token = actor.getActiveTokens(true, true)[0]
  if (!token) return makeAck(args)

  const { multiplier } = args
  if (multiplier === 1) {
    // Pass the Rolled<DamageRoll> directly so PF2e can apply per-type IWR.
    await actor.applyDamage({ damage: roll as never, token })
  } else {
    // Scaled or healing: compute the final number. PF2e treats negative as healing.
    const scaled = Math.floor(Math.abs(roll.total) * Math.abs(multiplier)) * Math.sign(multiplier)
    await actor.applyDamage({ damage: scaled, token })
  }

  return makeAck(args)
}
