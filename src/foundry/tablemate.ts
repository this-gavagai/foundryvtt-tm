import { setupListener } from './listener'
import type { UserPF2e, UserSourcePF2e } from '@7h3laughingman/pf2e-types'
import type FormDataExtended from '@7h3laughingman/foundry-types/client/applications/ux/form-data-extended.mjs'
import { logger } from '@/utils/utilities'
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
  flags?: {
    tablemate?: {
      originUserId?: string | null
    }
  }
  'flags.tablemate.originUserId'?: string | null
  getFlag?: (scope: string, key: string) => unknown
}
let chatOriginDisplayRegistered = false

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
