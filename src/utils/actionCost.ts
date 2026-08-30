// PF2e keeps an activity's cost in one free-text field — `system.time.value`
// on a spell, `system.actions.value` on an action — and that field holds two
// different kinds of thing. Usually it is a number of actions, which sheets
// draw with the Pathfinder2eActions icon font. But a slow activity states its
// cost in prose instead: "1 minute", "10 minutes", "8 hours", "1 day".
//
// Prose set in the icon font is unreadable. The font covers only 1-5 and
// a/d/f/r/t, so "1 minute" printed the one-action glyph for "1", the letters
// m/i/n/u/e from the fallback face, and — because "t" is in the font — the
// THREE-action glyph in the middle of the word. Hence this split: callers ask
// what kind of cost they have and render an icon or words accordingly.
//
// The glyph table mirrors PF2e's own `getActionGlyph`, so the costs that get
// an icon here are exactly the ones the system's sheets draw as icons, with
// the same multi-glyph strings for spreads ("1 – 3"). Everything absent from
// it — every prose cost, and anything a module invented — comes back as text.
//
// Letters (a/d/f/r/t) are in the table because @Glyph enrichers and this app's
// own call sites pass the font's own character codes, not just PF2e's data
// values. 4 and 5 are deliberately absent: they are the font's free-action and
// reaction characters, but as DATA a bare number means a count of actions, and
// no activity costs four actions.
const GLYPHS: Record<string, string> = {
  '0': 'f',
  f: 'f',
  free: 'f',
  'free action': 'f',
  '1': '1',
  a: '1',
  action: '1',
  'action 1': '1',
  '1 action': '1',
  'one action': '1',
  'single action': '1',
  '2': '2',
  d: '2',
  'action 2': '2',
  '2 actions': '2',
  'two actions': '2',
  '3': '3',
  t: '3',
  'action 3': '3',
  '3 actions': '3',
  'three actions': '3',
  r: 'r',
  reaction: 'r',
  '1 reaction': 'r',
  '1 or 2': '1/2',
  '1 to 3': '1 – 3',
  '2 or 3': '2/3',
  // Two rounds of Sustain reads as two 3-action glyphs in PF2e's sheets.
  '2 rounds': '3,3'
}

export type ActionCost =
  // `glyph` is a string for the Pathfinder2eActions font. Spreads mix in
  // separators the font does not carry ("/", "–", ","); those fall through to
  // the stack's fallback face on their own, which is what PF2e does too.
  | { kind: 'glyph'; glyph: string }
  // Prose, in the world's locale, to be printed as words. Empty when there is
  // no cost to show at all.
  | { kind: 'text'; text: string }

export function actionCost(value: string | number | null | undefined): ActionCost {
  const text = value === null || value === undefined ? '' : String(value).trim()
  // Hyphens only ever join words here ("free-action", "single-action"); the
  // dashes inside a glyph string are added by the table, never read from data.
  const key = text.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  const glyph = GLYPHS[key]
  return glyph ? { kind: 'glyph', glyph } : { kind: 'text', text }
}
