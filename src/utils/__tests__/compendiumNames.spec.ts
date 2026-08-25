// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Label-less @UUID[...] links (PF2e omits the label when it equals the linked
// document's name) render as a "…" placeholder, so every surface that shows
// Foundry HTML depends on this pass to give them their name back.
const getCompendiumName = vi.fn()
vi.mock('@/api/compendium', () => ({
  getCompendiumName: (uuid: string) => getCompendiumName(uuid)
}))

const { fillUuidLinkLabels } = await import('@/utils/compendiumNames')

const UUID = 'Compendium.pf2e.feats-srd.Item.BWomK7EVY0WXxWgh'

function root(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

beforeEach(() => {
  getCompendiumName.mockReset()
})

describe('fillUuidLinkLabels', () => {
  it('replaces the placeholder with the resolved document name', async () => {
    getCompendiumName.mockResolvedValue('Wonder Worker')
    const container = root(
      `<a class="content-link" data-uuid="${UUID}" data-type="Item" data-uuid-unresolved>…</a>`
    )

    fillUuidLinkLabels(container)
    await vi.waitFor(() => expect(container.textContent).toBe('Wonder Worker'))
    expect(container.querySelector('[data-uuid-unresolved]')).toBeNull()
  })

  it('resolves an actor-embedded item link the same way', async () => {
    getCompendiumName.mockResolvedValue('Staff of Fire')
    const container = root(
      '<a class="content-link" data-uuid="Actor.a1.Item.i1" data-type="Item" data-uuid-unresolved>…</a>'
    )

    fillUuidLinkLabels(container)
    await vi.waitFor(() => expect(container.textContent).toBe('Staff of Fire'))
    expect(getCompendiumName).toHaveBeenCalledWith('Actor.a1.Item.i1')
  })

  it('leaves already-labelled links untouched and looks nothing up', async () => {
    const container = root(
      `<a class="content-link" data-uuid="${UUID}" data-type="Item">Wonder Worker</a>`
    )
    fillUuidLinkLabels(container)
    expect(getCompendiumName).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Wonder Worker')
  })

  it('fetches a repeated uuid once and keeps the placeholder when nothing resolves', async () => {
    getCompendiumName.mockResolvedValue(undefined)
    const container = root(
      `<a class="content-link" data-uuid="Actor.gone.Item.gone" data-uuid-unresolved>…</a>` +
        `<a class="content-link" data-uuid="Actor.gone.Item.gone" data-uuid-unresolved>…</a>`
    )

    fillUuidLinkLabels(container)
    await vi.waitFor(() => expect(getCompendiumName).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe('……')
  })
})
