import { CapacitorCookies, CapacitorHttp, type HttpResponse } from '@capacitor/core'

import {
  JOIN_DATA_TIMEOUT_MS,
  readBrowserSessionCookie,
  VERIFY_CREDENTIALS_TIMEOUT_MS,
  type JoinData,
  type JoinUser,
  type ServerTransport
} from '@/api/serverTransport'

const SESSION_STORAGE_KEY = 'foundrySession'

function responseDataAsText(response: HttpResponse): string {
  return typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
}

function responseDataAsObject(response: HttpResponse): Record<string, unknown> {
  if (response.data && typeof response.data === 'object') return response.data
  if (typeof response.data !== 'string') return {}
  try {
    const parsed = JSON.parse(response.data)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readHeader(response: HttpResponse, headerName: string): string | undefined {
  const target = headerName.toLowerCase()
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === target)
  return entry?.[1]
}

function sessionFromSetCookie(setCookie: string | undefined): string | undefined {
  return setCookie?.match(/(?:^|,\s*)session=([^;,]+)/)?.[1]
}

function parseJoinUsers(html: string): JoinUser[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(document.querySelectorAll<HTMLSelectElement>('select[name="userid"] option'))
    .map((option) => ({
      _id: option.value,
      name: option.textContent?.trim() ?? option.value,
      role: 0,
      color: ''
    }))
    .filter((user) => user._id)
}

async function getNativeJoinData(serverUrl: URL): Promise<JoinData> {
  const response = await CapacitorHttp.get({
    url: new URL('/join', serverUrl).href,
    responseType: 'text',
    connectTimeout: JOIN_DATA_TIMEOUT_MS,
    readTimeout: JOIN_DATA_TIMEOUT_MS
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Join page returned ${response.status}`)
  }
  return {
    users: parseJoinUsers(responseDataAsText(response)),
    activeUsers: [],
    userId: null
  }
}

async function persistNativeSession(serverUrl: URL, response: HttpResponse) {
  const session =
    sessionFromSetCookie(readHeader(response, 'set-cookie')) ??
    (await CapacitorCookies.getCookies({ url: serverUrl.origin })).session
  if (!session) return
  localStorage.setItem(SESSION_STORAGE_KEY, session)
  await CapacitorCookies.setCookie({
    url: serverUrl.origin,
    key: 'session',
    value: session,
    path: '/'
  })
}

export const capacitorServerTransport: ServerTransport = {
  readSession(): string | undefined {
    return readBrowserSessionCookie() ?? localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined
  },

  async getJoinData(serverUrl: URL, socketJoinData: () => Promise<JoinData>): Promise<JoinData> {
    try {
      return await socketJoinData()
    } catch {
      return getNativeJoinData(serverUrl)
    }
  },

  async verifyCredentials(serverUrl: URL, userid: string, password: string): Promise<boolean> {
    try {
      const response = await CapacitorHttp.post({
        url: new URL('/join', serverUrl).href,
        headers: { 'Content-Type': 'application/json' },
        data: { action: 'join', password, userid },
        connectTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS,
        readTimeout: VERIFY_CREDENTIALS_TIMEOUT_MS
      })
      if (response.status < 200 || response.status >= 300) return false
      const data = responseDataAsObject(response)
      if (data?.status !== 'success') return false
      await persistNativeSession(serverUrl, response)
      return true
    } catch {
      return false
    }
  }
}
