import { computed, onBeforeUnmount, readonly, ref } from 'vue'
import { logger } from '@/utils/utilities'

// Microphone capture for voice memos, built on the WebView's MediaRecorder.
// Works in the PWA, iOS WKWebView, and Android WebView — all of which require a
// secure context and a granted mic permission. The recorded Blob is handed off
// to the chunked upload (see utils/voiceMemoChunks.ts + api sendVoiceMemo).

export type RecorderState = 'idle' | 'recording' | 'recorded' | 'error'

// Prefer a container every playback target can decode. iOS/Safari produce
// audio/mp4 (AAC); Chromium produces webm/opus but can't PLAY mp4-less webm on
// Safari, so mp4 first keeps a memo recorded on desktop playable on iOS and
// vice-versa. '' lets the browser pick when none are advertised as supported.
const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
]

function pickMimeType(): string {
  const supported = (
    globalThis.MediaRecorder as typeof MediaRecorder | undefined
  )?.isTypeSupported?.bind(globalThis.MediaRecorder)
  if (!supported) return ''
  return MIME_CANDIDATES.find((type) => supported(type)) ?? ''
}

// Recording needs MediaRecorder + getUserMedia + a secure context. Foundry
// served over plain http on a LAN fails the secure-context check, so the
// composer hides the mic there rather than throwing on tap.
export function audioRecordingSupported(): boolean {
  return (
    typeof globalThis.MediaRecorder !== 'undefined' &&
    !!globalThis.navigator?.mediaDevices?.getUserMedia &&
    globalThis.isSecureContext === true
  )
}

export function useAudioRecorder(options: { maxDurationMs?: number } = {}) {
  const maxDurationMs = options.maxDurationMs ?? 300_000

  const state = ref<RecorderState>('idle')
  const elapsedMs = ref(0)
  const errorKind = ref<'permission' | 'unsupported' | 'failed' | null>(null)
  const recordedBlob = ref<Blob | null>(null)
  const recordedUrl = ref<string | null>(null)
  const mimeType = ref('')

  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: BlobPart[] = []
  let elapsedTimer: ReturnType<typeof setInterval> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let startedAt = 0

  const isRecording = computed(() => state.value === 'recording')
  const canPreview = computed(() => state.value === 'recorded' && !!recordedUrl.value)

  function clearTimers() {
    if (elapsedTimer) clearInterval(elapsedTimer)
    if (maxTimer) clearTimeout(maxTimer)
    elapsedTimer = null
    maxTimer = null
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
  }

  function revokePreview() {
    if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value)
    recordedUrl.value = null
  }

  async function start() {
    if (state.value === 'recording') return
    revokePreview()
    recordedBlob.value = null
    elapsedMs.value = 0
    errorKind.value = null

    if (!audioRecordingSupported()) {
      state.value = 'error'
      errorKind.value = 'unsupported'
      return
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      // NotAllowedError (denied/dismissed) is by far the common case; treat any
      // getUserMedia rejection as "no mic access" for the user-facing message.
      logger.warn('voice memo: microphone access failed', error)
      state.value = 'error'
      errorKind.value = 'permission'
      stopStream()
      return
    }

    const preferred = pickMimeType()
    try {
      recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream)
    } catch (error) {
      logger.warn('voice memo: MediaRecorder init failed', error)
      state.value = 'error'
      errorKind.value = 'failed'
      stopStream()
      return
    }

    chunks = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = () => {
      clearTimers()
      stopStream()
      const type = recorder?.mimeType || preferred || 'audio/webm'
      const blob = new Blob(chunks, { type })
      chunks = []
      mimeType.value = type
      recordedBlob.value = blob
      revokePreview()
      recordedUrl.value = URL.createObjectURL(blob)
      state.value = 'recorded'
      recorder = null
    }

    startedAt = performance.now()
    // No timeslice: a single dataavailable on stop yields the whole clip, which
    // is all the chunked upload needs.
    recorder.start()
    state.value = 'recording'
    elapsedTimer = setInterval(() => {
      elapsedMs.value = performance.now() - startedAt
    }, 200)
    // Hard cap: auto-stop at the max so a forgotten recording can't run away.
    maxTimer = setTimeout(() => stop(), maxDurationMs)
  }

  function stop() {
    if (recorder && state.value === 'recording') {
      // onstop finalizes the blob and flips state to 'recorded'.
      recorder.stop()
    }
  }

  // Discard the current recording (or a mid-recording take) and return to idle.
  function reset() {
    clearTimers()
    if (recorder && state.value === 'recording') {
      recorder.onstop = null
      recorder.stop()
    }
    recorder = null
    chunks = []
    stopStream()
    revokePreview()
    recordedBlob.value = null
    elapsedMs.value = 0
    errorKind.value = null
    state.value = 'idle'
  }

  onBeforeUnmount(reset)

  return {
    state: readonly(state),
    isRecording,
    canPreview,
    elapsedMs: readonly(elapsedMs),
    errorKind: readonly(errorKind),
    recordedBlob: readonly(recordedBlob),
    recordedUrl: readonly(recordedUrl),
    mimeType: readonly(mimeType),
    maxDurationMs,
    start,
    stop,
    reset
  }
}
