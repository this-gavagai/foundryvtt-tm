// "Pause push" — a GM's switch for keeping test sessions off the players' phones.
//
// A GM who logs in to try something out produces chat and turn changes the same
// as a real session does, and every one of them would buzz someone's pocket. The
// switch lives in Foundry's chat sidebar, next to core's export/clear buttons,
// and holds every push (chat and turn alerts) for as long as the GM who flipped
// it is online.
//
// The state is a flag on that GM's own User document rather than anything local
// to their browser, because the sender is the PRIMARY GM's client (see
// isPrimaryGM) and that need not be the GM who paused. Every client sees the
// flag, so whoever sends can honour it.
//
// The flag only counts while its GM is `active`. That is what makes "pushes
// resume when I leave" hold without any cleanup step: a closed tab, a crashed
// browser and a dropped connection all end the pause the moment Foundry notices
// the user is gone, though the flag itself is still sitting on the document.
//
// What brings it back on the next visit is this tab's sessionStorage. Reloading
// keeps the pause (a GM testing module changes reloads constantly); a new tab or
// a new day starts with pushes flowing, so a pause forgotten during testing
// cannot silently swallow the next real session's turn alerts. On load the GM's
// client writes its flag to match whatever the tab remembers.

import { MODULE_ID } from '@/api/protocol'
import { logger } from '@/utils/utilities'
import { hooks, onHook, settingsApi } from './globals'
import { PUSH_ENABLED_SETTING } from './pushRegistration'

const PAUSE_FLAG = 'pushPaused'

const BUTTON_CLASS = 'tm-push-pause'
const NOTICE_CLASS = 'tm-push-pause-notice'

interface PausingGM {
  id: string
  name: string
}

// The GMs currently holding pushes: online, and flagged. Read straight off
// `flags`, as worldUsers does, so a plain user object answers the same as a live
// document.
export function pushPausedBy(): PausingGM[] {
  return game.users.contents
    .filter((u) => u.isGM && u.active && u.flags?.[MODULE_ID]?.[PAUSE_FLAG] === true)
    .map((u) => ({ id: u.id, name: u.name }))
}

export function isPushPaused(): boolean {
  return pushPausedBy().length > 0
}

// ── This tab's memory of the pause ─────────────────────────────────────────

// Per world and user: switching worlds in the same tab must not carry a pause
// into a world that was never paused.
function storageKey(): string {
  return `tablemate.pushPaused.${game.world?.id}.${game.user?.id}`
}

function rememberedPause(): boolean {
  try {
    return window.sessionStorage?.getItem(storageKey()) === '1'
  } catch {
    return false
  }
}

function rememberPause(paused: boolean): void {
  try {
    if (paused) window.sessionStorage?.setItem(storageKey(), '1')
    else window.sessionStorage?.removeItem(storageKey())
  } catch {
    // Storage can throw (private mode, blocked site data). The flag still
    // works for this page load; it just won't survive a reload.
  }
}

function ownFlag(): boolean {
  return game.user?.flags?.[MODULE_ID]?.[PAUSE_FLAG] === true
}

async function writeOwnFlag(paused: boolean): Promise<void> {
  const user = game.user
  if (!user || ownFlag() === paused) return
  if (paused) await user.setFlag(MODULE_ID, PAUSE_FLAG, true)
  else await user.unsetFlag(MODULE_ID, PAUSE_FLAG)
}

async function setOwnPause(paused: boolean): Promise<void> {
  rememberPause(paused)
  try {
    await writeOwnFlag(paused)
  } catch (error) {
    logger.warn('TABLEMATE: could not change the push pause', error)
  }
}

// ── Chat sidebar UI ────────────────────────────────────────────────────────

function pushEnabled(): boolean {
  try {
    return settingsApi().get(MODULE_ID, PUSH_ENABLED_SETTING) === true
  } catch {
    return false
  }
}

function makeButton(): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `ui-control icon fa-solid fa-bell-slash ${BUTTON_CLASS}`
  button.dataset.tooltip = ''
  // No data-action: when the controls sit in the sidebar, ChatLog would claim
  // the click for an action it doesn't have.
  button.addEventListener('click', () => void setOwnPause(!ownFlag()))
  return button
}

function makeNotice(): HTMLDivElement {
  const notice = document.createElement('div')
  notice.className = NOTICE_CLASS
  // Self-contained styling, as settingsHeaders.ts does, so no stylesheet wiring
  // is needed. A warning-coloured rule so it reads as a state, not a message.
  notice.style.display = 'flex'
  notice.style.alignItems = 'center'
  notice.style.gap = '6px'
  notice.style.padding = '4px 8px'
  notice.style.fontSize = 'var(--font-size-12, 12px)'
  notice.style.borderLeft = '3px solid var(--color-level-warning, #ee9b3a)'
  notice.style.background = 'var(--color-cool-5-75, rgba(0, 0, 0, 0.25))'
  notice.style.borderRadius = '4px'
  return notice
}

// Who is holding pushes, said from this GM's point of view.
function noticeText(pausers: PausingGM[]): string {
  const me = game.user?.id
  if (pausers.length === 1 && pausers[0].id === me) {
    return 'Push notifications paused until you log off'
  }
  const names = pausers.map((p) => (p.id === me ? 'you' : p.name))
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return `Push notifications paused by ${who} until ${names.length > 1 ? 'they all' : 'they'} log off`
}

// One notice for the life of the page, moved along with the chat controls.
let notice: HTMLDivElement | null = null

// Bring the button and notice in line with the current state. Idempotent, and
// called on every event that could change either — including core moving the
// chat controls between the sidebar, its popout and the floating notifications.
export function refreshPushPauseUi(): void {
  if (!game.user?.isGM) return
  const controls = document.getElementById('chat-controls')
  if (!controls) return
  const enabled = pushEnabled()

  const buttons = controls.querySelector('.control-buttons')
  let button = controls.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`)
  if (!button && buttons) {
    button = makeButton()
    buttons.prepend(button)
  }
  if (button) {
    const mine = ownFlag()
    button.hidden = !enabled
    button.setAttribute('aria-pressed', String(mine))
    button.setAttribute(
      'aria-label',
      mine
        ? 'Resume push notifications'
        : 'Pause push notifications to phones until you log off'
    )
  }

  const pausers = enabled ? pushPausedBy() : []
  // Only beside the embedded controls. When the sidebar is collapsed core floats
  // the controls next to the notifications with absolute positioning, and its
  // own control buttons are hidden there too.
  const embedded = controls.parentElement?.matches('.chat-form') === true
  if (!pausers.length || !embedded) {
    notice?.remove()
    return
  }
  notice ??= makeNotice()
  notice.innerHTML = '<i class="fa-solid fa-bell-slash" inert></i>'
  notice.append(noticeText(pausers))
  if (notice.nextElementSibling !== controls) controls.before(notice)
}

// ── Wiring ─────────────────────────────────────────────────────────────────

let registered = false

export function setupPushPause(): void {
  if (registered || !game.user?.isGM) return
  registered = true

  // Core re-places the controls (and fires this) on every chat render and every
  // sidebar collapse/expand.
  onHook('renderChatInput', refreshPushPauseUi)
  // A GM flipping their flag, and a GM arriving or leaving — the latter is what
  // ends a pause on everyone else's screen.
  hooks().on('updateUser', refreshPushPauseUi)
  hooks().on('userConnected', refreshPushPauseUi)
  for (const hook of ['createSetting', 'updateSetting']) {
    hooks().on(hook, (...args: unknown[]) => {
      const key = (args[0] as { key?: unknown } | null)?.key
      if (key === `${MODULE_ID}.${PUSH_ENABLED_SETTING}`) refreshPushPauseUi()
    })
  }

  // The sidebar rendered before `ready`, so the first renderChatInput has
  // already gone by.
  refreshPushPauseUi()
  void setOwnPause(rememberedPause())
}
