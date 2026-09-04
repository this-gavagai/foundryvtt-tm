// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mountComponent } from './mountComponent'
import ChatMessageRow from '@/components/ChatMessageRow.vue'
import type { ChatMessageView } from '@/composables/useChatMessages'

// Which of the two pictures the gutter draws — the author's avatar or the
// initials badge — is stated only in this template's v-if/v-else-if, and the
// colors that identify a player are inline styles on it. Nothing below the
// component can see either, which is what this harness is for (see
// mountComponent).

vi.mock('@/composables/useHapticFeedback', () => ({
  triggerLightHapticFeedback: vi.fn(),
  triggerLongPressHapticFeedback: vi.fn()
}))

const BADGE = { background: '#ffdd00', foreground: '#000000', initials: 'PP' }

function view(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    message: { _id: 'msg-1', content: 'hello', flags: {} },
    key: 'msg-1',
    speakerName: 'Plain Player',
    authorName: 'Plain Player',
    showAuthorName: false,
    formattedTime: '10:00',
    visibilityLabel: null,
    whisperRecipients: [],
    isOwnActor: false,
    isOwnMessage: false,
    isAuthor: false,
    senderKey: 'Plain Player Plain Player',
    groupStart: true,
    groupEnd: true,
    hasPortrait: true,
    portraitScale: { '--sx': 1, '--sy': 1 },
    isOutOfCharacter: true,
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

function rowFor(over: Partial<ChatMessageView>) {
  return mountComponent(ChatMessageRow, {
    props: {
      view: view(over),
      unread: false,
      actorId: 'seelah-id',
      inlineCheckLabel: () => '',
      actions: {
        canTriggerDamageAction: () => false,
        canTriggerRollAction: () => false,
        isDamageActionPending: () => false,
        isRollActionPending: () => false,
        isCommentPending: () => false,
        isReactionPending: () => false,
        toggleMessageReaction: vi.fn()
      },
      groupStart: true,
      groupEnd: true,
      reactionsSupported: false,
      commentsSupported: false,
      viewerIsGM: false
    }
  })
}

describe('the out-of-character gutter', () => {
  it('draws the initials badge, in the player’s colors, when there is no avatar', () => {
    const badge = rowFor({ authorBadge: BADGE }).find('[data-part="chat-author-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('PP')
    expect(badge.attributes('style')).toContain('background-color: rgb(255, 221, 0)')
    expect(badge.attributes('style')).toContain('color: rgb(0, 0, 0)')
  })

  it('draws the avatar instead when the player has one, and no badge with it', () => {
    const row = rowFor({ authorBadge: BADGE, portrait: 'players/peter.webp' })
    expect(row.find('[data-part="chat-author-badge"]').exists()).toBe(false)
    expect(row.find('[data-part="chat-portrait"] img').attributes('src')).toContain(
      'players/peter.webp'
    )
  })

  it('squares off either one and outlines it in the player’s color', () => {
    // Shape and outline are what separate "the human said this" from a
    // character portrait at a glance — squared against the round frame a
    // dynamic-ring token draws — so both ride on the box, not the picture.
    for (const over of [{ authorBadge: BADGE }, { authorBadge: BADGE, portrait: 'a.webp' }]) {
      const box = rowFor(over).find('[data-part="chat-portrait"]')
      expect(box.attributes('style')).toContain('border-color: rgb(255, 221, 0)')
      expect(box.classes()).toContain('rounded')
      expect(box.classes()).not.toContain('rounded-full')
      // Clipped to its own corners: a user avatar carries none of a token's
      // deliberate overflow, and an uncropped one breaks the gutter's edge.
      expect(box.classes()).toContain('overflow-hidden')
    }
  })

  it('leaves an in-character portrait unoutlined, and free to overflow', () => {
    const box = rowFor({
      isOutOfCharacter: false,
      portrait: 'tokens/seelah.webp',
      speakerName: 'Seelah'
    }).find('[data-part="chat-portrait"]')
    expect(box.attributes('style')).toBeUndefined()
    // A token scaled past its frame is meant to spill (large-creature art).
    expect(box.classes()).toContain('overflow-visible')
    expect(box.find('img').attributes('alt')).toBe('Seelah')
  })
})
