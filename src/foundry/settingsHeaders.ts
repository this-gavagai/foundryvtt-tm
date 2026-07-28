// Cosmetic section headers for Tablemate's block of the Foundry Settings config.
//
// Foundry's game.settings.register has no "group" or "header" concept — every
// setting simply renders in registration order under the module's name. To break
// that flat list into labelled sections we hook renderSettingsConfig (fired when
// the Settings config app draws) and splice an <h3> in front of the first setting
// of each section. This is pure client-side DOM decoration: it touches no world
// data and runs harmlessly on every client, GM or player.
//
// The section anchors below are the FIRST setting of each group and are all
// registered unconditionally (config: true), so each header always has a visible
// element to attach to. Ordering is driven by the register* call order in
// setupListener (listener.ts); keep these in sync with that order or a header
// will land in front of the wrong setting.

import { MODULE_ID } from '@/api/protocol'
import {
  MANUAL_ROLL_POLICY_SETTING
} from './manualRollPolicy'
import { VOICE_MEMO_PATH_SETTING } from './voiceMemoSetting'
import { TRANSCRIPTION_ENDPOINT_SETTING } from './transcriptionSetting'
import { PUSH_ENABLED_SETTING } from './pushRegistration'

// title -> the setting key whose form-group the header is inserted before.
const SECTIONS: Array<{ title: string; beforeKey: string }> = [
  { title: 'Dice rolls', beforeKey: MANUAL_ROLL_POLICY_SETTING },
  { title: 'Voice memos', beforeKey: VOICE_MEMO_PATH_SETTING },
  { title: 'Voice memo transcription', beforeKey: TRANSCRIPTION_ENDPOINT_SETTING },
  { title: 'Push notifications', beforeKey: PUSH_ENABLED_SETTING }
]

// Marker class, used both for styling and to detect a header we already inserted
// so a re-render never stacks duplicates.
const HEADER_CLASS = 'tm-settings-header'

function makeHeader(title: string): HTMLHeadingElement {
  const h = document.createElement('h3')
  h.className = HEADER_CLASS
  h.textContent = title
  // Self-contained styling so no module stylesheet wiring is required. Mirrors
  // Foundry's own settings sub-headers: full-width rule under a small-caps label.
  h.style.margin = '1em 0 0.5em'
  h.style.paddingBottom = '0.25em'
  h.style.borderBottom = '1px solid var(--color-border-light-primary, #b5b3a4)'
  h.style.fontVariant = 'small-caps'
  h.style.fontWeight = 'bold'
  return h
}

// Insert the section headers by locating each anchor setting's form-group and
// splicing an <h3> in front of it. `scope` is whatever we search within (the
// hook's element, or document as a fallback). Returns how many headers landed.
function insertHeaders(scope: ParentNode): number {
  let inserted = 0
  for (const { title, beforeKey } of SECTIONS) {
    // v14 renders each setting as a .form-group containing an input/select/
    // custom-element with name="module.key" (see createFormGroup in core). There
    // is no data-setting-id, so we anchor on the name attribute.
    const group = scope
      .querySelector(`[name="${MODULE_ID}.${beforeKey}"]`)
      ?.closest('.form-group')
    if (!group?.parentElement) continue

    // Skip if we already inserted this header on a prior pass.
    const prev = group.previousElementSibling
    if (prev?.classList.contains(HEADER_CLASS) && prev.textContent === title) continue

    group.parentElement.insertBefore(makeHeader(title), group)
    inserted++
  }
  return inserted
}

export function setupSettingsHeaders() {
  // ApplicationV2 fires renderSettingsConfig as (app, element, context, options)
  // with element being the app's root HTMLElement.
  Hooks.on('renderSettingsConfig', (_app: unknown, element: unknown) => {
    const root: HTMLElement | undefined =
      element instanceof HTMLElement
        ? element
        : (element as { 0?: HTMLElement })?.[0]
    if (!root) return

    // Defer one frame: at renderSettingsConfig time the category part content is
    // not yet reachable from the hook's element, so an immediate query finds
    // nothing. After a frame it is attached; fall back to a document-wide search
    // as a belt-and-suspenders (only ever one SettingsConfig is open).
    globalThis.requestAnimationFrame(() => {
      if (insertHeaders(root) === 0) insertHeaders(document)
    })
  })
}
