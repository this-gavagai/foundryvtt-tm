import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// The native asset path, which the pure-helper spec next door doesn't reach.
//
// It shipped broken: CapacitorHttp rewrites responseType to 'json' whenever the
// server labels a body application/json — which Foundry does for every ring
// spritesheet — so the blob request the loader made came back already parsed,
// the base64 branch saw an object instead of a string, and every ring on the
// native build failed while the web build (plain fetch) was fine.

const httpGet = vi.fn()
const isNative = vi.fn(() => true)

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative()
  },
  CapacitorHttp: {
    get: (options: { url: string }) => httpGet(options)
  }
}))

vi.mock('@/utils/utilities', () => ({
  getMediaPath: (path: string) => `https://example.test/${path}`,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const SHEET = {
  config: { defaultColorBand: { startRadius: 0.666, endRadius: 0.72 }, defaultRingColor: '#400c07' },
  frames: {
    'med-ring-bkg': { frame: { x: 0, y: 0, w: 512, h: 512 } },
    'med-ring': { frame: { x: 512, y: 0, w: 512, h: 512 }, gridTarget: 1 }
  },
  meta: { image: 'rings-bronze.webp' }
}

const REQUEST = {
  spritesheet: 'canvas/tokens/rings-bronze.json',
  gridSize: 1,
  ringColor: null,
  backgroundColor: null,
  px: 64
}

// Minimal canvas stubs: the test is about getting the manifest parsed, not
// about the compositing, which the pure helpers already cover.
function stubCanvas() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 512 })))
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return {
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
          putImageData: vi.fn()
        }
      }
      async convertToBlob() {
        return new Blob([])
      }
    }
  )
  // Patch the one method, not the whole global: replacing URL with an object
  // literal strips the constructor other code still needs.
  URL.createObjectURL = vi.fn(() => 'blob:ring') as unknown as typeof URL.createObjectURL
}

describe('ring assets over CapacitorHttp', () => {
  beforeEach(async () => {
    vi.resetModules()
    httpGet.mockReset()
    isNative.mockReturnValue(true)
    stubCanvas()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the manifest when CapacitorHttp hands back parsed json', async () => {
    httpGet.mockImplementation(async ({ url }: { url: string }) =>
      url.endsWith('.json')
        ? // What actually happens: responseType is forced to 'json' upstream.
          { status: 200, data: SHEET }
        : { status: 200, data: btoa('webp-bytes') }
    )

    const { ringLayers, __resetRingCaches } = await import('../tokenRingAssets')
    __resetRingCaches()

    await expect(ringLayers(REQUEST)).resolves.toMatchObject({ ring: expect.any(String) })
  })

  it('still loads it when the body arrives as a json string', async () => {
    httpGet.mockImplementation(async ({ url }: { url: string }) =>
      url.endsWith('.json')
        ? { status: 200, data: JSON.stringify(SHEET) }
        : { status: 200, data: btoa('webp-bytes') }
    )

    const { ringLayers, __resetRingCaches } = await import('../tokenRingAssets')
    __resetRingCaches()

    await expect(ringLayers(REQUEST)).resolves.toMatchObject({ ring: expect.any(String) })
  })

  it('rejects on an http error rather than resolving to a blank ring', async () => {
    httpGet.mockResolvedValue({ status: 404, data: '' })

    const { ringLayers, __resetRingCaches } = await import('../tokenRingAssets')
    __resetRingCaches()

    await expect(ringLayers(REQUEST)).rejects.toThrow(/404/)
  })
})
