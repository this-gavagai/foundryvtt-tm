// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

// The composable's whole job is deciding when to ask again, so the wake lock
// itself is the thing to fake: `request` is what gets counted, and making it
// reject is how a Battery Saver denial is spelled.
const request = vi.fn<(type: string) => Promise<void>>()
const isSupported = ref(true)

vi.mock('@vueuse/core', () => ({
  useWakeLock: () => ({ request, isSupported })
}))

const { useKeepScreenAwake } = await import('@/composables/useKeepScreenAwake')

// A click through the document, which is what the listener is bound to.
const click = () => document.dispatchEvent(new Event('click'))

// The listener awaits the request, so settling it takes a turn of the loop.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// A listener that was refused stays bound — that is the fix under test — so it
// outlives the case that bound it, and jsdom hands every case the same
// `document`. Left alone, a refusal in one test answers the clicks in the next.
// Capture what each case binds and unbind it afterwards, so each starts clean.
const bound: EventListener[] = []

describe('useKeepScreenAwake', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue(undefined)
    isSupported.value = true
    vi.spyOn(document, 'addEventListener').mockImplementation(function (
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'click') bound.push(listener as EventListener)
      return EventTarget.prototype.addEventListener.call(this, type, listener, options)
    } as Document['addEventListener'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const listener of bound) document.removeEventListener('click', listener, false)
    bound.length = 0
  })

  it('asks for the lock on the first click', async () => {
    useKeepScreenAwake()
    expect(request).not.toHaveBeenCalled()

    click()
    await settle()
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('stops listening once a lock is actually held', async () => {
    useKeepScreenAwake()

    click()
    await settle()
    click()
    await settle()

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('tries again on the next click when the lock was refused', async () => {
    // Chrome on Android refuses while Battery Saver is on. That can be switched
    // off mid-session, so a refusal must not end the attempt for good — which
    // is what unbinding the listener before awaiting used to do.
    request.mockRejectedValue(new Error('NotAllowedError'))
    useKeepScreenAwake()

    click()
    await settle()
    click()
    await settle()

    expect(request).toHaveBeenCalledTimes(2)
  })

  it('takes the lock on a later click after an earlier refusal', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowedError'))
    useKeepScreenAwake()

    click()
    await settle()
    click()
    await settle()
    // Held now, so the third click has nothing left to do.
    click()
    await settle()

    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not leave a second request in flight behind the first', async () => {
    // Two sentinels would mean one held lock nothing holds a reference to, so
    // nothing could ever release it.
    let release: () => void = () => {}
    request.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)))
    useKeepScreenAwake()

    click()
    click()
    await settle()
    expect(request).toHaveBeenCalledTimes(1)

    release()
    await settle()
  })

  it('binds nothing at all when the browser has no wake lock', async () => {
    isSupported.value = false
    useKeepScreenAwake()

    click()
    await settle()
    expect(request).not.toHaveBeenCalled()
  })
})
