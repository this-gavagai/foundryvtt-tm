// Intercepts spell-card button clicks (attack/damage) on chat messages that
// carry Tablemate target token ids, routing the roll at the player's chosen
// target instead of the GM's current Foundry selection.

import type { ActorPF2e, GamePF2e, SpellPF2e } from '@7h3laughingman/pf2e-types'
import { logger } from '@/utils/utilities'
import {
  chatMessageElement,
  findRenderedChatMessage,
  hasTablemateTargetTokenIds,
  tablemateTargetTokenIds,
  type TablemateChatMessage
} from './utils/chatMessage'
import { noFallbackTargetActor, resolveTarget } from './utils/target'
import { rollSpellDamageWithTarget } from './utils/spellTargeting'

let spellCardTargetingRegistered = false

function spellFromMessage(message: TablemateChatMessage): SpellPF2e<ActorPF2e> | null {
  const item = message.item
  if (!item) return null
  if (item.isOfType?.('spell')) return item as SpellPF2e<ActorPF2e>
  if (item.isOfType?.('consumable')) return item.embeddedSpell ?? null
  return null
}

function spellAttackNumber(action: string): 1 | 2 | 3 | null {
  switch (action) {
    case 'spell-attack':
      return 1
    case 'spell-attack-2':
      return 2
    case 'spell-attack-3':
      return 3
    default:
      return null
  }
}

function spellDamageMapIncreases(button: HTMLButtonElement): 0 | 1 | 2 | undefined {
  const raw = Number(button.dataset.mapIncreases)
  return raw === 0 || raw === 1 || raw === 2 ? raw : undefined
}

async function handleTargetedSpellCardClick(
  message: TablemateChatMessage,
  event: MouseEvent,
  button: HTMLButtonElement
) {
  const action = button.dataset.action ?? ''
  const attackNumber = spellAttackNumber(action)
  const rollsDamage = action === 'spell-damage'
  if (!attackNumber && !rollsDamage) return

  const spell = spellFromMessage(message)
  if (!spell) return

  const targetTokenIds = tablemateTargetTokenIds(message)

  const { actorProxy, tokenDoc } = resolveTarget(game as GamePF2e, targetTokenIds)

  event.preventDefault()
  event.stopImmediatePropagation()

  const pointerEvent = event as PointerEvent
  if (attackNumber) {
    await spell.rollAttack(pointerEvent, attackNumber, {
      target: actorProxy ?? noFallbackTargetActor(spell.actor)
    })
    return
  }

  if (rollsDamage) {
    await rollSpellDamageWithTarget(spell, pointerEvent, spellDamageMapIncreases(button), tokenDoc)
  }
}

export function setupSpellCardTargeting() {
  if (spellCardTargetingRegistered) return
  spellCardTargetingRegistered = true

  Hooks.on('renderChatMessageHTML', (message: TablemateChatMessage, html: unknown) => {
    if (!hasTablemateTargetTokenIds(message)) return
    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (!element) return

    element
      .querySelectorAll<HTMLButtonElement>(
        '.card-buttons button[data-action^="spell-"], button[data-action^="spell-"]'
      )
      .forEach((button) => {
        button.addEventListener(
          'click',
          (event) => {
            handleTargetedSpellCardClick(message, event, button).catch((error) =>
              logger.warn('failed to route Tablemate spell card target', error)
            )
          },
          { capture: true }
        )
      })
  })
}
