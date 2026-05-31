import type { SaveType } from '@7h3laughingman/pf2e-types'
import { type CheckRollHandler, statisticParams } from './types'

// PF2e's Statistic API (save/skill/perception/initiative) expects
// params.target to be an ActorPF2e — it calls target.getActiveTokens() on it
// to drive DC/display. statisticParams swaps in the actor proxy that exposes
// getActiveTokens on behalf of the player's chosen target.

export const handleSkill: CheckRollHandler = (ctx) =>
  ctx.actor.skills[ctx.args.checkSubtype].check.roll(statisticParams(ctx))

export const handleSave: CheckRollHandler = (ctx) =>
  ctx.actor.saves[ctx.args.checkSubtype as SaveType].check.roll(statisticParams(ctx))

export const handlePerception: CheckRollHandler = (ctx) =>
  ctx.actor.perception.check.roll(statisticParams(ctx))

export const handleInitiative: CheckRollHandler = (ctx) =>
  ctx.actor.initiative.roll(statisticParams(ctx))
