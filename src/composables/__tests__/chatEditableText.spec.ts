// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { chatContentToEditableText } from '@/composables/useChatMessages'

// chatContentToEditableText reverses formatChatContent (escape + newlines→<br>)
// so an edited message repopulates the composer with the text the user typed.
describe('chatContentToEditableText', () => {
  it('turns <br> back into newlines', () => {
    expect(chatContentToEditableText('line one<br>line two')).toBe('line one\nline two')
  })

  it('handles self-closing and spaced <br/> variants', () => {
    expect(chatContentToEditableText('a<br/>b<br />c')).toBe('a\nb\nc')
  })

  it('decodes HTML entities back to their characters', () => {
    expect(chatContentToEditableText('&lt;tag&gt; &amp; &quot;q&quot;')).toBe('<tag> & "q"')
  })

  it('strips any stray markup rather than showing tags', () => {
    expect(chatContentToEditableText('<strong>bold</strong> text')).toBe('bold text')
  })

  it('trims surrounding whitespace', () => {
    expect(chatContentToEditableText('  hi  ')).toBe('hi')
  })

  it('returns an empty string for null/undefined/empty', () => {
    expect(chatContentToEditableText(null)).toBe('')
    expect(chatContentToEditableText(undefined)).toBe('')
    expect(chatContentToEditableText('')).toBe('')
  })
})
