// code used from github.com/reonZ/pf2e-hub
import type { Game } from '@/types/foundry-types'

interface CharacterPF2e {
  attributes: { reach: { base: number } }
}
type ElementTrait = string
interface ActionBlast {
  [key: string]: object
}

declare const game: Game

export async function getBlastData(
  actor: CharacterPF2e,
  elementTrait?: ElementTrait
): Promise<ActionBlast | ActionBlast[] | undefined> {
  const blastData = new game.pf2e.ElementalBlast(actor)

  const configs = elementTrait
    ? blastData.configs.filter((c: any) => c.element === elementTrait)
    : blastData.configs

  const reach =
    actor.attributes.reach.base + (blastData.infusion?.traits.melee.includes('reach') ? 5 : 0)

  const blasts = await Promise.all(
    configs.map(async (config: any): Promise<ActionBlast> => {
      const damageType = config.damageTypes.find((dt: any) => dt.selected)?.value ?? 'untyped'

      const formulaFor = (
        outcome: 'success' | 'criticalSuccess',
        melee: boolean
      ): Promise<string | null> =>
        blastData.damage({
          element: config.element,
          damageType,
          melee,
          outcome,
          getFormula: true
        })

      return {
        ...config,
        attack: (event: MouseEvent, mapIncreases: number) => {
          return blastData.attack({
            event,
            mapIncreases,
            melee: true, //TODO: this should also be possibly false//el.dataset.melee === 'true',
            damageType,
            element: config.element
          })
        },
        damage: (event: MouseEvent) => {
          return blastData.damage({
            event,
            damageType,
            element: config.element,
            melee: true, //el.dataset.melee === 'true',
            outcome: 'success' //el.dataset.outcome === 'success' ? 'success' : 'criticalSuccess'
          })
        },
        reach: reach, //localize('sidebars.actions.reach', { reach }),
        damageType,
        formula: {
          melee: {
            damage: await formulaFor('success', true),
            critical: await formulaFor('criticalSuccess', true)
          },
          ranged: {
            damage: await formulaFor('success', false),
            critical: await formulaFor('criticalSuccess', false)
          }
        }
      }
    })
  )

  return elementTrait ? blasts[0] : blasts
}
