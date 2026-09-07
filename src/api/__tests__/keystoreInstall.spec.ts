// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The purge runs at module load, so the platform, the container and the marker
// all have to be arranged before the import — hence resetModules and the
// dynamic import in every case.
const isNativePlatform = vi.fn(() => true)
const clear = vi.fn()
const readdir = vi.fn()
const writeFile = vi.fn()

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
    writeFile: (...args: unknown[]) => writeFile(...args)
  }
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: { clear: (...args: unknown[]) => clear(...args) },
  KeychainAccess: { afterFirstUnlockThisDeviceOnly: 3 }
}))

const MARKER = 'tm-keystore-install'

// A container the app has already been running in, as opposed to the empty one
// a fresh install starts with.
function containerInUse() {
  localStorage.setItem('tablemate.serverUrl', 'https://vtt.example.com')
}

function markerOnDisk(present: boolean) {
  readdir.mockResolvedValue({ files: present ? [{ name: MARKER }] : [{ name: 'Caches' }] })
}

async function launch() {
  vi.resetModules()
  const { keystoreReady } = await import('@/api/keystoreInstall')
  await keystoreReady()
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  isNativePlatform.mockReturnValue(true)
  clear.mockResolvedValue(undefined)
  writeFile.mockResolvedValue({ uri: 'file:///x' })
  markerOnDisk(false)
})

describe('keystoreInstall', () => {
  it('purges the keystore the previous install left behind', async () => {
    await launch()
    expect(clear).toHaveBeenCalledOnce()
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: MARKER }))
  })

  it('leaves the keystore alone on every later launch of the same install', async () => {
    markerOnDisk(true)
    await launch()
    expect(clear).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('claims the keystore of an install that predates the marker', async () => {
    containerInUse()
    await launch()
    expect(clear).not.toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: MARKER }))
  })

  it('runs the check once per launch however many callers await it', async () => {
    vi.resetModules()
    const { keystoreReady } = await import('@/api/keystoreInstall')
    await Promise.all([keystoreReady(), keystoreReady(), keystoreReady()])
    expect(clear).toHaveBeenCalledOnce()
  })

  it('keeps the keystore when the filesystem cannot say whether the marker is there', async () => {
    readdir.mockRejectedValue(new Error('no such volume'))
    await launch()
    expect(clear).not.toHaveBeenCalled()
  })

  it('sweeps again next launch when the keystore refuses to clear', async () => {
    clear.mockRejectedValue(new Error('keychain locked'))
    await launch()
    expect(writeFile).not.toHaveBeenCalled()
    clear.mockResolvedValue(undefined)
    await launch()
    expect(clear).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('does nothing off-device, where there is no keystore to orphan', async () => {
    isNativePlatform.mockReturnValue(false)
    await launch()
    expect(readdir).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
