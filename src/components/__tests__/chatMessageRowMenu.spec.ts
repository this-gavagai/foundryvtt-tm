// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mountComponent } from './mountComponent'
import ChatMessageRow from '@/components/ChatMessageRow.vue'
import KebabMenu from '@/components/widgets/KebabMenu.vue'
import type { ChatMessageView } from '@/composables/useChatMessages'

// Who may edit or delete a message is stated only in this component's computeds
// and template, so this is the one place it can be pinned. Both rules were got
// wrong before: Delete was offered on every card the GM's client posted on a
// player's behalf (which Foundry refuses), and withheld from the GM who may
// delete anything.

vi.mock('@/composables/useHapticFeedback', () => ({
  triggerLightHapticFeedback: vi.fn(),
  triggerLongPressHapticFeedback: vi.fn()
}))

function view(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    message: { _id: 'msg-1', content: 'hello', flags: {} },
    key: 'msg-1',
    speakerName: 'Seelah',
    authorName: 'Player',
    showAuthorName: false,
    formattedTime: '10:00',
    visibilityLabel: null,
    whisperRecipients: [],
    isOwnActor: true,
    isOwnMessage: true,
    isAuthor: true,
    senderKey: 'Seelah Player',
    groupStart: true,
    groupEnd: true,
    hasPortrait: false,
    portraitScale: { '--sx': 1, '--sy': 1 },
    preparedContent: 'hello',
    showContent: true,
    showEmptyMessage: false,
    rolls: [],
    inlineChecks: [],
    reactions: [],
    comments: [],
    ...over
  } as ChatMessageView
}

const actions = {
  canTriggerDamageAction: () => false,
  canTriggerRollAction: () => false,
  isDamageActionPending: () => false,
  isRollActionPending: () => false,
  isCommentPending: () => false,
  isReactionPending: () => false,
  toggleMessageReaction: vi.fn()
}

function menuFor(over: Partial<ChatMessageView>, viewerIsGM = false) {
  const wrapper = mountComponent(ChatMessageRow, {
    props: {
      view: view(over),
      unread: false,
      actorId: 'seelah-id',
      inlineCheckLabel: () => '',
      actions,
      groupStart: true,
      groupEnd: true,
      reactionsSupported: false,
      commentsSupported: false,
      viewerIsGM
    }
  })
  // The kebab's panel is teleported and only rendered while open, so assert on
  // the items it was GIVEN — which is `menuItems`, the computed under test —
  // rather than on Headless UI's open state.
  const kebab = wrapper.findComponent(KebabMenu)
  if (!kebab.exists()) return []
  return (kebab.props('items') as { id: string }[]).map((i) => i.id)
}

describe('the message menu', () => {
  it('offers delete on a message this user authored', () => {
    expect(menuFor({ isAuthor: true })).toContain('delete')
  })

  // A roll or spell card the GM's client posted carries the player's origin
  // flag, so it reads as theirs — but its author is the GM, and Foundry refuses
  // a non-author's delete. Offering it spent a socket round trip to find out.
  it('withholds delete on a card posted on this user’s behalf', () => {
    expect(menuFor({ isAuthor: false, isOwnMessage: true })).not.toContain('delete')
  })

  it('withholds delete on someone else’s message', () => {
    expect(menuFor({ isAuthor: false, isOwnMessage: false })).not.toContain('delete')
  })

  // A GM moderates the log from Foundry's own sidebar, so the sheet standing in
  // for that client offers the same.
  it('offers a GM delete on anyone’s message', () => {
    expect(menuFor({ isAuthor: false, isOwnMessage: false }, true)).toContain('delete')
  })

  // Deleting reads as removal; rewriting would leave someone's name on words
  // they did not write, so edit stays with the author.
  it('does not offer a GM edit on someone else’s message', () => {
    expect(menuFor({ isAuthor: false, isOwnMessage: false }, true)).not.toContain('edit')
  })

  it('offers edit on the author’s own plain-text message', () => {
    expect(menuFor({ isAuthor: true })).toContain('edit')
  })
})
