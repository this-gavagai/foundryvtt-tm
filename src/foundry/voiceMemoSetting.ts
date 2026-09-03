// World-scoped GM setting for the destination folder of uploaded voice memos.
// Registered as a module setting so the GM controls it from Foundry's settings
// UI. It doubles as the feature's enable switch: with no folder configured the
// module withholds the voice-memo capability from its handshake (see
// listener.ts announceSelf), so the app hides the mic and never records — and
// the upload handler refuses defensively even if a request slips through.

import { MODULE_ID } from '@/api/protocol'
import { settingsApi } from './globals'

export const VOICE_MEMO_PATH_SETTING = 'voiceMemoPath'

// Setting strings are raw English, matching the other module settings (the
// module ships no Foundry lang files).
export function registerVoiceMemoSetting(onChange: () => void) {
  settingsApi().register(MODULE_ID, VOICE_MEMO_PATH_SETTING, {
    name: 'Voice memo upload folder',
    hint:
      'Data-relative folder where Tabula saves uploaded voice memos ' +
      '(e.g. "tablemate/voice-memos"). Leave blank to disable voice memos ' +
      'entirely — players cannot record until a folder is set here.',
    scope: 'world',
    config: true,
    type: String,
    // Foundry renders a folder-picker button beside the text field for a String
    // setting with filePicker set; 'folder' restricts it to choosing (or
    // creating) a directory, which is exactly what the upload destination is.
    filePicker: 'folder',
    default: '',
    onChange
  })
}

// The configured upload folder, normalized to a clean Data-relative path, or ''
// when unset/invalid. Leading/trailing slashes are stripped, and any '.'/'..'
// segment voids the path so a stray traversal can't escape the Data root.
export function voiceMemoUploadPath(): string {
  try {
    const raw = settingsApi().get(MODULE_ID, VOICE_MEMO_PATH_SETTING)
    if (typeof raw !== 'string') return ''
    const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
    if (!trimmed) return ''
    if (trimmed.split('/').some((segment) => segment === '.' || segment === '..')) return ''
    return trimmed
  } catch {
    // Setting not registered yet (or an unexpectedly old world): treat as
    // unconfigured, i.e. disabled.
    return ''
  }
}

// Whether voice memos are enabled for this world (a destination is configured).
export function voiceMemoEnabled(): boolean {
  return voiceMemoUploadPath().length > 0
}
