// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// What a rendered comment does when you click it, and what reaches core's
// DialogV2 when you edit one.
//
// Both are contracts with Foundry rather than with our own code, which is why
// they are worth pinning: DialogV2 takes the content element's *innerHTML*
// (dialog.mjs #_initializeApplicationOptions), so anything held only as a DOM
// property — a textarea's `value`, most of all — is gone by the time the dialog
// renders, and the box opens empty. And core's per-message context menu is
// bound to the chat log by delegation, so a comment's own contextmenu handler
// has to stop the event or both open at once.

const promptMock = vi.fn(async (_config: unknown) => undefined)

let commentsOn = true
vi.mock('@/foundry/featureToggles', () => ({ commentsEnabled: () => commentsOn }))

const { applyCommentDisplay } = await import('@/foundry/commentDisplay')

type Comment = { id: string; userId: string; text: string; createdAt: number }

function message(comments: Comment[]) {
  return { id: 'msg-1', flags: { tablemate: { comments } } }
}

function render(comments: Comment[], element = document.createElement('li')) {
  // applyCommentDisplay is typed for a live ChatMessage; these doubles carry the
  // id and flags it actually reads.
  applyCommentDisplay(message(comments) as never, element)
  return element
}

const mine = (over: Partial<Comment> = {}): Comment => ({
  id: 'c-1',
  userId: 'user-1',
  text: 'Nice roll',
  createdAt: 0,
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  commentsOn = true
  ;(globalThis as Record<string, unknown>).game = {
    user: { _id: 'user-1', isGM: false },
    users: { get: () => ({ name: 'Someone' }), activeGM: { id: 'gm-1' } },
    socket: { emit: vi.fn() }
  }
  ;(globalThis as Record<string, unknown>).foundry = {
    applications: { api: { DialogV2: { prompt: promptMock } } }
  }
})

describe('a rendered comment', () => {
  it('opens the editor on right-click', () => {
    const element = render([mine()])
    const comment = element.querySelector<HTMLElement>('.tm-comment')!
    comment.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  it('does not open it on a left click, so the text stays selectable', () => {
    const element = render([mine()])
    element
      .querySelector<HTMLElement>('.tm-comment')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('keeps the message context menu from opening alongside the dialog', () => {
    const element = render([mine()])
    const seenByChatLog = vi.fn()
    element.addEventListener('contextmenu', seenByChatLog)

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.querySelector<HTMLElement>('.tm-comment')!.dispatchEvent(event)

    expect(seenByChatLog).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it("offers no editor for someone else's comment", () => {
    const element = render([mine({ userId: 'someone-else' })])
    element
      .querySelector<HTMLElement>('.tm-comment')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(promptMock).not.toHaveBeenCalled()
  })
})

describe('the editor', () => {
  function openOn(text: string) {
    const element = render([mine({ text })])
    element
      .querySelector<HTMLElement>('.tm-comment')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    return promptMock.mock.calls[0][0] as {
      window: { title: string }
      content: HTMLDivElement
    }
  }

  it('opens holding the comment as it stands', () => {
    const { content } = openOn('Nice roll')
    const textarea = content.querySelector('textarea')!
    expect(textarea.value).toBe('Nice roll')
    // The one that actually matters: DialogV2 renders content.innerHTML, so the
    // text has to survive being serialized to markup.
    expect(content.innerHTML).toContain('Nice roll')
  })

  it('survives the round trip with markup in the text', () => {
    const { content } = openOn('<b>not bold</b> & fine')
    const reparsed = document.createElement('div')
    reparsed.innerHTML = content.innerHTML
    expect(reparsed.querySelector('textarea')!.value).toBe('<b>not bold</b> & fine')
  })

  it('says it is editing, not adding', () => {
    expect(openOn('Nice roll').window.title).toBe('Edit comment')
  })
})

describe('the feature switch', () => {
  it('draws nothing when comments are off', () => {
    commentsOn = false
    expect(render([mine()]).querySelector('.tm-comment')).toBeNull()
  })

  it('clears comments already drawn when it is turned off mid-session', () => {
    const element = render([mine()])
    expect(element.querySelector('.tm-comment')).not.toBeNull()
    commentsOn = false
    render([mine()], element)
    expect(element.querySelector('.tm-comment')).toBeNull()
  })
})
