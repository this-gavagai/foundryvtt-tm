import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { Capacitor } from '@capacitor/core'

const SERVER_URL_STORAGE_KEY = 'tablemate.serverUrl'
const DEFAULT_PROTOCOL = 'http://'

function isNativeMobileBuild(): boolean {
  const platform = Capacitor.getPlatform()
  return Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android')
}

function normalizeServerUrl(input: string): URL {
  const trimmed = input.trim()
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${DEFAULT_PROTOCOL}${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server URL must use HTTP or HTTPS')
  }
  return new URL(url.origin)
}

function readStoredServerUrl(): URL | undefined {
  const stored = localStorage.getItem(SERVER_URL_STORAGE_KEY)
  if (!stored) return undefined
  try {
    return normalizeServerUrl(stored)
  } catch {
    localStorage.removeItem(SERVER_URL_STORAGE_KEY)
    return undefined
  }
}

export const useServerAddressStore = defineStore('serverAddress', () => {
  const isNativeMobile = ref(isNativeMobileBuild())
  const serverUrl = ref<URL | undefined>(
    isNativeMobile.value ? readStoredServerUrl() : new URL(window.location.origin)
  )
  const serverUrlText = computed(() => serverUrl.value?.origin ?? '')
  const needsServerUrl = computed(() => isNativeMobile.value && !serverUrl.value)

  function setServerUrl(input: string): URL {
    const normalized = normalizeServerUrl(input)
    serverUrl.value = normalized
    if (isNativeMobile.value) localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized.origin)
    return normalized
  }

  function clearServerUrl() {
    serverUrl.value = isNativeMobile.value ? undefined : new URL(window.location.origin)
    localStorage.removeItem(SERVER_URL_STORAGE_KEY)
  }

  return {
    isNativeMobile,
    serverUrl,
    serverUrlText,
    needsServerUrl,
    setServerUrl,
    clearServerUrl
  }
})
