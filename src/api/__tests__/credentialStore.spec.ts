// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The keystore gate is read at module load, so the platform mock has to be in
// place before the module under test is imported — hence the dynamic imports
// and resetModules below.
const isNativePlatform = vi.fn(() => true)
const get = vi.fn()
const set = vi.fn()
const remove = vi.fn()
const clear = vi.fn()
const readdir = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
    getPlatform: () => 'ios'
  }
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readdir: (...args: unknown[]) => readdir(...args),
    writeFile: () => Promise.resolve({ uri: 'file:///x' })
  }
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: (...args: unknown[]) => get(...args),
    set: (...args: unknown[]) => set(...args),
    remove: (...args: unknown[]) => remove(...args),
    clear: (...args: unknown[]) => clear(...args)
  },
  KeychainAccess: { afterFirstUnlockThisDeviceOnly: 3 }
}))

const ORIGIN = 'https://vtt.example.com'

async function loadStore() {
  vi.resetModules()
  return import('@/api/credentialStore')
}

beforeEach(() => {
  vi.clearAllMocks()
  isNativePlatform.mockReturnValue(true)
  set.mockResolvedValue(undefined)
  remove.mockResolvedValue(true)
  clear.mockResolvedValue(undefined)
  // A marker already on disk, so the reinstall sweep (see keystoreInstall)
  // stays out of the way of every case that isn't about it.
  readdir.mockResolvedValue({ files: [{ name: 'tm-keystore-install' }] })
})

describe('credentialStore on a device', () => {
  it('round-trips a credential under a per-origin key', async () => {
    const { readCredential, writeCredential } = await loadStore()
    await writeCredential(ORIGIN, 'user1', 'hunter2')

    const [key, value] = set.mock.calls[0]
    expect(key).toContain(ORIGIN)
    expect(value).toEqual({ userid: 'user1', password: 'hunter2' })

    get.mockResolvedValue({ userid: 'user1', password: 'hunter2' })
    await expect(readCredential(ORIGIN)).resolves.toEqual({
      userid: 'user1',
      password: 'hunter2'
    })
  })

  // afterFirstUnlock so a push-woken re-auth works with the screen locked;
  // ThisDeviceOnly to keep the password out of iCloud and device backups.
  it('stores with the intended keychain accessibility', async () => {
    const { writeCredential } = await loadStore()
    await writeCredential(ORIGIN, 'user1', 'hunter2')
    expect(set.mock.calls[0][4]).toBe(3)
  })

  it('keeps servers separate', async () => {
    const { writeCredential } = await loadStore()
    await writeCredential(ORIGIN, 'user1', 'a')
    await writeCredential('https://other.example.com', 'user2', 'b')
    expect(set.mock.calls[0][0]).not.toBe(set.mock.calls[1][0])
  })

  // A read failure must look like "no saved password" (fall back to the login
  // page), never like a wrong one — and it must never delete anything.
  it('reports no credential when the keystore read fails', async () => {
    const { readCredential } = await loadStore()
    get.mockRejectedValue(new Error('keychain locked'))
    await expect(readCredential(ORIGIN)).resolves.toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
  })

  it('ignores a malformed stored value', async () => {
    const { readCredential } = await loadStore()
    get.mockResolvedValue({ userid: 'user1' })
    await expect(readCredential(ORIGIN)).resolves.toBeUndefined()
  })

  // Failing to save costs the convenience, not the login the user just made.
  it('does not throw when the keystore write fails', async () => {
    const { writeCredential } = await loadStore()
    set.mockRejectedValue(new Error('keychain full'))
    await expect(writeCredential(ORIGIN, 'user1', 'hunter2')).resolves.toBeUndefined()
  })
})

describe('credentialStore off-device', () => {
  // The plugin silently falls back to localStorage on the web. The browser
  // build is served by Foundry itself, where the session cookie already works,
  // so a password must never be written there.
  it('never touches storage without a real keystore', async () => {
    isNativePlatform.mockReturnValue(false)
    const { readCredential, writeCredential, forgetCredential } = await loadStore()

    await expect(readCredential(ORIGIN)).resolves.toBeUndefined()
    await writeCredential(ORIGIN, 'user1', 'hunter2')
    await forgetCredential(ORIGIN)

    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

// The keychain outlives the app on iOS, so a reinstalled app finds the previous
// install's password sitting there (see keystoreInstall). Every entry point
// here waits on that sweep rather than reading — or writing — across it.
describe('credentialStore and the reinstall sweep', () => {
  beforeEach(() => {
    // No marker: this launch is the one that sweeps.
    readdir.mockResolvedValue({ files: [] })
  })

  it('reads nothing until the sweep has finished', async () => {
    const order: string[] = []
    // Arranged before the import: the sweep starts the moment the module loads,
    // so a spy installed afterwards would miss the very call being pinned.
    clear.mockImplementation(async () => {
      order.push('clear:start')
      await Promise.resolve()
      order.push('clear:done')
    })
    get.mockImplementation(() => {
      order.push('get')
      return Promise.resolve(null)
    })
    const { readCredential } = await loadStore()
    await readCredential(ORIGIN)
    expect(order).toEqual(['clear:start', 'clear:done', 'get'])
  })

  it('does not let a fresh login be swept away with the old install', async () => {
    const order: string[] = []
    clear.mockImplementation(async () => {
      order.push('clear:start')
      await Promise.resolve()
      order.push('clear:done')
    })
    set.mockImplementation(() => {
      order.push('set')
      return Promise.resolve()
    })
    const { writeCredential } = await loadStore()
    await writeCredential(ORIGIN, 'user1', 'hunter2')
    expect(order).toEqual(['clear:start', 'clear:done', 'set'])
  })
})
