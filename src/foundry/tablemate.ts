import { setupListener } from './listener'
import type {
  ActorPF2e,
  GamePF2e,
  SpellPF2e,
  UserPF2e,
  UserSourcePF2e
} from '@7h3laughingman/pf2e-types'
import type FormDataExtended from '@7h3laughingman/foundry-types/client/applications/ux/form-data-extended.mjs'
import { logger } from '@/utils/utilities'
import { noFallbackTargetActor, resolveTarget } from './utils/target'
import { rollSpellDamageWithTarget } from './utils/spellTargeting'
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api
declare interface SheetableUser extends UserPF2e {
  sheeted: boolean
}
declare interface PlayerSelectContext {
  users: SheetableUser[]
  buttons: { type: string; action: string; label: string }[]
  tabs?: undefined
}
type TablemateChatMessage = {
  id?: string | null
  _id?: string | null
  author?: { id?: string; _id?: string; name?: string } | null
  item?: {
    isOfType?: (...types: string[]) => boolean
    embeddedSpell?: SpellPF2e<ActorPF2e> | null
    rollAttack?: (
      event: PointerEvent,
      attackNumber?: number,
      context?: { target?: ActorPF2e | null }
    ) => Promise<unknown>
    rollDamage?: (event: PointerEvent, mapIncreases?: 0 | 1 | 2) => Promise<unknown>
  } | null
  flags?: {
    tablemate?: {
      originUserId?: string | null
      targetTokenIds?: string[] | null
    }
  }
  'flags.tablemate.targetTokenIds'?: string[] | null
  'flags.tablemate.originUserId'?: string | null
  getFlag?: (scope: string, key: string) => unknown
}
let chatOriginDisplayRegistered = false
let spellCardTargetingRegistered = false

console.log('TM tablemate.mjs MODE:', import.meta.env.MODE, 'PROD:', import.meta.env.PROD)
logger.info('TM initializing...')

Hooks.on('init', function () {
  const user = game.data.users.find((x: UserSourcePF2e) => x._id === game.userId)
  if (user?.flags?.['tablemate']?.['character_sheet'] === 'root') {
    logger.info('TM HERE', user?.character)
    const url = user?.character
      ? `${window.location.origin}/modules/tablemate/index.html?id=${user.character}`
      : `${window.location.origin}/modules/tablemate/index.html`
    window.location.assign(url)
  }
})

Hooks.on('ready', () => {
  setupListener()
  setupChatOriginDisplay()
  setupSpellCardTargeting()

  logger.info('tablemate hello')
  game.settings.registerMenu('tablemate', 'playerSelectMenu', {
    name: 'User Select',
    label: 'Select Character Sheet users',
    hint: 'Select which users will load the alternate Character Sheet instead of the standard Foundry environment',
    type: PlayerSelectMenu as ConstructorOf<foundry.applications.api.ApplicationV2>,
    icon: 'fas fa-user',
    restricted: true
  })
})

function tablemateOriginUserId(message: TablemateChatMessage): string | undefined {
  const flagged = message.getFlag?.('tablemate', 'originUserId')
  return (
    (typeof flagged === 'string' ? flagged : undefined) ??
    message.flags?.tablemate?.originUserId ??
    message['flags.tablemate.originUserId'] ??
    undefined
  )
}

function tablemateTargetTokenIds(message: TablemateChatMessage): string[] {
  const flagged = message.getFlag?.('tablemate', 'targetTokenIds')
  const value =
    (Array.isArray(flagged) ? flagged : undefined) ??
    message.flags?.tablemate?.targetTokenIds ??
    message['flags.tablemate.targetTokenIds'] ??
    []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function hasTablemateTargetTokenIds(message: TablemateChatMessage): boolean {
  return (
    Array.isArray(message.getFlag?.('tablemate', 'targetTokenIds')) ||
    Array.isArray(message.flags?.tablemate?.targetTokenIds) ||
    Array.isArray(message['flags.tablemate.targetTokenIds'])
  )
}

function chatMessageElement(html: unknown): HTMLElement | undefined {
  if (html instanceof HTMLElement) return html
  if (typeof DocumentFragment !== 'undefined' && html instanceof DocumentFragment) {
    return html.firstElementChild instanceof HTMLElement ? html.firstElementChild : undefined
  }
  if (!html || typeof html !== 'object') return undefined

  const maybeCollection = html as {
    0?: unknown
    get?: (index: number) => unknown
    querySelector?: unknown
  }
  if (typeof maybeCollection.querySelector === 'function') return html as HTMLElement

  const first =
    typeof maybeCollection.get === 'function' ? maybeCollection.get(0) : maybeCollection[0]
  return first instanceof HTMLElement ? first : undefined
}

function chatMessageId(message: TablemateChatMessage): string | undefined {
  return message.id ?? message._id ?? undefined
}

function findRenderedChatMessage(message: TablemateChatMessage): HTMLElement | undefined {
  const id = chatMessageId(message)
  if (!id) return undefined
  return (
    document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`[data-document-id="${CSS.escape(id)}"]`) ??
    document.querySelector<HTMLElement>(`#chat-message-${CSS.escape(id)}`) ??
    undefined
  )
}

function applyChatOriginDisplay(
  message: TablemateChatMessage,
  originUserId: string,
  element: HTMLElement
) {
  const originName = game.users.get(originUserId)?.name ?? originUserId
  const header = element.querySelector<HTMLElement>('.message-header')

  const sender =
    header?.querySelector<HTMLElement>('.message-sender') ??
    header?.querySelector<HTMLElement>('h4') ??
    element.querySelector<HTMLElement>('.message-sender')
  const authorName = message.author?.name
  if (sender && authorName && sender.textContent?.trim() === authorName) {
    sender.textContent = originName
    sender.title = `${originName} via Tablemate`
  }

  const pf2eUser = header?.querySelector<HTMLElement>('.user')
  if (pf2eUser) {
    pf2eUser.textContent = originName
    pf2eUser.title = `${originName} via Tablemate`
  }
}

function patchRenderedChatOrigin(message: TablemateChatMessage) {
  const originUserId = tablemateOriginUserId(message)
  if (!originUserId) return

  const patch = () => {
    const element = findRenderedChatMessage(message)
    if (element) applyChatOriginDisplay(message, originUserId, element)
  }
  patch()
  window.requestAnimationFrame(patch)
  window.setTimeout(patch, 50)
  window.setTimeout(patch, 250)
}

function setupChatOriginDisplay() {
  if (chatOriginDisplayRegistered) return
  chatOriginDisplayRegistered = true

  Hooks.on('renderChatMessageHTML', (message: TablemateChatMessage, html: unknown) => {
    const originUserId = tablemateOriginUserId(message)
    if (!originUserId) return

    const element = chatMessageElement(html) ?? findRenderedChatMessage(message)
    if (element) applyChatOriginDisplay(message, originUserId, element)

    window.requestAnimationFrame(() => {
      const rendered = findRenderedChatMessage(message)
      if (rendered) applyChatOriginDisplay(message, originUserId, rendered)
    })
  })
  Hooks.on('createChatMessage', (message: TablemateChatMessage) => {
    patchRenderedChatOrigin(message)
  })
  Hooks.on('updateChatMessage', (message: TablemateChatMessage) => {
    patchRenderedChatOrigin(message)
  })
}

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

function setupSpellCardTargeting() {
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

class PlayerSelectMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'PlayerSelectMenu',
    actions: {},
    window: {
      title: 'Character Sheet mode',
      icon: 'fas fa-user'
    },
    tag: 'form',
    form: {
      handler: PlayerSelectMenu.updateUserFlags,
      submitOnChange: true,
      closeOnSubmit: false
    }
  }
  static PARTS = {
    form: {
      template: 'modules/tablemate/templates/userSelect.hbs'
    },
    footer: {
      template: 'templates/generic/form-footer.hbs'
    }
  }
  async _prepareContext(): Promise<PlayerSelectContext> {
    const users = game.users.filter((u: UserPF2e) => !u.isGM) as SheetableUser[]
    users.forEach((s) => {
      s.sheeted = s.getFlag('tablemate', 'character_sheet') === 'root'
    })
    const buttons = [{ type: 'button', action: 'close', label: 'Close' }]
    return { users, buttons }
  }

  static async updateUserFlags(event: Event, form: HTMLFormElement, formData: FormDataExtended) {
    // Do things with the returned FormData
    for (const id in formData.object) {
      const usr = game.users.get(id)
      if (formData.object[id]) {
        if (usr?.getFlag('tablemate', 'character_sheet') !== 'root')
          usr?.setFlag('tablemate', 'character_sheet', 'root')
      } else {
        if (usr?.getFlag('tablemate', 'character_sheet'))
          usr?.unsetFlag('tablemate', 'character_sheet')
      }
    }
  }
}
