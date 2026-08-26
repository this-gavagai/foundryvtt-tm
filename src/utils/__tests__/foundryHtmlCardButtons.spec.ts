// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { activeRollFromSpellSaveButton, cardRollFromClickTarget } from '@/utils/foundryHtml'

// These parsers are the only thing standing between PF2e's card markup and the
// rolls this app fires from it. Nothing else validates that contract: the
// attributes below (data-action, data-overlay-ids, data-identifier, data-save,
// data-dc, data-outcome) are PF2e's, not ours, so a rename upstream would
// otherwise surface as a button that silently stops working in a live world.
//
// The fixtures are trimmed copies of the system's own templates —
// templates/chat/spell-card.hbs and templates/chat/strike-card.hbs.

function render(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

function button(html: string, selector: string): HTMLElement {
  const found = render(html).querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`fixture has no ${selector}`)
  return found
}

const SPELL_CARD = `
<div class="pf2e chat-card item-card" data-cast-rank="3" data-item-id="EjaZK2YL8pbiA4Be">
  <header class="card-header flexrow">
    <h3>Heal <span class="action-glyph">1 – 3</span></h3>
    <h4 class="rank">Spell 3</h4>
  </header>
  <section class="card-buttons">
    <button type="button" data-action="spell-save" data-save="fortitude" data-dc="21">
      Save DC 21 basic Fortitude
    </button>
    <section class="owner-buttons">
      <div class="spell-attack-buttons">
        <button type="button" data-action="spell-attack" data-visibility="owner">Attack</button>
        <button type="button" data-action="spell-attack-2" data-visibility="owner">MAP -5</button>
        <button type="button" data-action="spell-attack-3" data-visibility="owner">MAP -10</button>
      </div>
      <div class="spell-button">
        <button type="button" data-action="spell-damage" data-visibility="owner">Roll Damage</button>
      </div>
      <div class="spell-button">
        <button type="button" data-action="spell-template" data-visibility="owner">Place Burst</button>
      </div>
      <button type="button" data-action="spell-variant" data-visibility="owner">Select Other Variant</button>
    </section>
  </section>
</div>`

// data-identifier is "<itemId>.<slug>.<melee|ranged>" — the only thing naming
// which strike (and which of its usages) the buttons roll.
const STRIKE_CARD = `
<div class="pf2e chat-card action-card" data-identifier="Yl9jT2Kq1s0dPqZx.staff.melee">
  <header class="card-header flexrow"><h3>Melee Strike: Staff</h3></header>
  <div class="card-buttons" data-visibility="owner">
    <button type="button" data-action="strike-attack">+13</button>
    <button type="button" data-action="strike-attack2">+8</button>
    <button type="button" data-action="strike-attack3">+3</button>
    <div class="card-buttons-two-column">
      <button type="button" data-action="strike-damage" data-outcome="success">Damage</button>
      <button type="button" data-action="strike-damage" data-outcome="critical-success">Critical</button>
    </div>
  </div>
</div>`

describe('cardRollFromClickTarget — spell cards', () => {
  it.each([
    ['spell-attack', 0],
    ['spell-attack-2', 1],
    ['spell-attack-3', 2]
  ])('maps %s to MAP step %i', (action, variant) => {
    expect(cardRollFromClickTarget(button(SPELL_CARD, `[data-action="${action}"]`))).toEqual({
      kind: 'spell',
      phase: 'attack',
      variant
    })
  })

  it('recognizes the damage button', () => {
    expect(cardRollFromClickTarget(button(SPELL_CARD, '[data-action="spell-damage"]'))).toEqual({
      kind: 'spell',
      phase: 'damage'
    })
  })

  it.each(['spell-save', 'spell-variant', 'spell-template'])(
    'does not treat %s as a roll button',
    (action) => {
      expect(
        cardRollFromClickTarget(button(SPELL_CARD, `[data-action="${action}"]`))
      ).toBeUndefined()
    }
  )

  // The click lands on the inner <span>/text, not the <button> itself.
  it('resolves from a descendant of the button', () => {
    const glyph = document.createElement('span')
    button(SPELL_CARD, '[data-action="spell-damage"]').appendChild(glyph)
    expect(cardRollFromClickTarget(glyph)).toEqual({ kind: 'spell', phase: 'damage' })
  })
})

describe('cardRollFromClickTarget — strike cards', () => {
  const strike = { actionSlug: 'staff', itemId: 'Yl9jT2Kq1s0dPqZx', usage: 'melee' }

  // PF2e hyphenates the spell MAP suffix but not the strike one; a parser that
  // pattern-matched instead of listing both spellings would miss these.
  it.each([
    ['strike-attack', 0],
    ['strike-attack2', 1],
    ['strike-attack3', 2]
  ])('maps %s to MAP step %i and carries the strike identity', (action, variant) => {
    expect(cardRollFromClickTarget(button(STRIKE_CARD, `[data-action="${action}"]`))).toEqual({
      kind: 'strike',
      phase: 'attack',
      variant,
      strike
    })
  })

  it('reads the plain damage button as non-critical', () => {
    expect(cardRollFromClickTarget(button(STRIKE_CARD, '[data-outcome="success"]'))).toEqual({
      kind: 'strike',
      phase: 'damage',
      critical: false,
      strike
    })
  })

  it('reads the critical damage button as critical', () => {
    expect(
      cardRollFromClickTarget(button(STRIKE_CARD, '[data-outcome="critical-success"]'))
    ).toEqual({ kind: 'strike', phase: 'damage', critical: true, strike })
  })

  it('keeps the ranged usage distinct from the melee one', () => {
    const ranged = STRIKE_CARD.replace('staff.melee', 'staff.ranged')
    const roll = cardRollFromClickTarget(button(ranged, '[data-action="strike-attack"]'))
    expect(roll).toMatchObject({ strike: { usage: 'ranged' } })
  })

  // Without an identifier there is nothing to tell the module which strike to
  // roll, so the button must go unrecognized rather than roll something wrong.
  it('ignores a strike button on a card with no identifier', () => {
    const orphan = STRIKE_CARD.replace(' data-identifier="Yl9jT2Kq1s0dPqZx.staff.melee"', '')
    expect(cardRollFromClickTarget(button(orphan, '[data-action="strike-attack"]'))).toBeUndefined()
  })

  it('tolerates an identifier missing its usage segment', () => {
    const partial = STRIKE_CARD.replace('Yl9jT2Kq1s0dPqZx.staff.melee', 'Yl9jT2Kq1s0dPqZx.staff')
    expect(cardRollFromClickTarget(button(partial, '[data-action="strike-attack"]'))).toEqual({
      kind: 'strike',
      phase: 'attack',
      variant: 0,
      strike: { actionSlug: 'staff', itemId: 'Yl9jT2Kq1s0dPqZx', usage: undefined }
    })
  })
})

describe('cardRollFromClickTarget — unrecognized input', () => {
  it('ignores a button outside a .card-buttons row', () => {
    const stray = button(
      '<div class="chat-card"><button data-action="spell-damage">x</button></div>',
      'button'
    )
    expect(cardRollFromClickTarget(stray)).toBeUndefined()
  })

  // The allowlist in main.css hides these, but a parser that guessed at unknown
  // actions would still be a way to fire the wrong roll.
  it('ignores an action it does not know', () => {
    const future = button(
      '<div class="chat-card"><div class="card-buttons"><button data-action="spell-something-new">x</button></div></div>',
      'button'
    )
    expect(cardRollFromClickTarget(future)).toBeUndefined()
  })
})

describe('activeRollFromSpellSaveButton', () => {
  it('reads the save slug and DC off the button', () => {
    expect(activeRollFromSpellSaveButton(button(SPELL_CARD, '[data-action="spell-save"]'))).toEqual(
      {
        action: 'check',
        slug: 'fortitude',
        label: 'Save DC 21 basic Fortitude',
        dc: 21
      }
    )
  })

  it('omits an unparseable DC rather than sending NaN', () => {
    const noDc = SPELL_CARD.replace('data-dc="21"', 'data-dc=""')
    expect(activeRollFromSpellSaveButton(button(noDc, '[data-action="spell-save"]'))).toMatchObject(
      {
        slug: 'fortitude',
        dc: undefined
      }
    )
  })

  it('ignores buttons that are not save buttons', () => {
    expect(
      activeRollFromSpellSaveButton(button(SPELL_CARD, '[data-action="spell-damage"]'))
    ).toBeUndefined()
  })
})
