import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Socket } from 'socket.io-client'
import { useUserStore, rememberLoginUser, lastLoginUser } from '@/stores/user'
import { useServerAddressStore, serverUrlCandidates } from '@/stores/serverAddress'
import { logger } from '@/utils/utilities'
import { TM } from '@/api/protocol'
import {
  emitWithRetries,
  emitWithTimeout,
  establishSocket,
  getServerTransport
} from '@/api/socketConnection'
import { createReconnectPolicy } from '@/api/reconnectPolicy'
import {
  JOIN_DATA_RETRY_ATTEMPTS,
  JOIN_DATA_TIMEOUT_MS,
  type JoinData,
  type JoinUser,
  type ServerTransport
} from '@/api/serverTransport'

export type { JoinData, JoinUser }

const GET_SOCKET_TIMEOUT_MS = 15_000
const PROBE_CONNECTION_TIMEOUT_MS = 3_000
const SESSION_WATCHDOG_TIMEOUT_MS = 8_000
// How many times a stalled handshake with a *confirmed-valid* session is
// repaired with a fresh socket before giving up and showing the login page
// anyway (so the user is never stranded on a spinner by a pathological server).
const MAX_STALLED_HANDSHAKE_RETRIES = 3

// Session lifecycle hooks, registered by the connection wiring
// (composables/serverEventWiring.ts). Inverting these keeps this store free of
// world/character-sync imports — previously a server ⇄ world module cycle.
// Hooks run synchronously inside the session handler at the exact points the
// inlined calls used to run, so their ordering guarantees are unchanged.
export interface SessionHooks {
  // Fired before the new userId is committed, when the session's user differs
  // from the previous one (server switch, or re-login as someone else).
  onUserChanged?: () => void
  // Fired after sessionReady flips true — on every session handshake, initial
  // auth and every reconnect re-auth alike.
  onSessionAuthenticated?: () => void
}

export const useServerStore = defineStore('server', () => {
  const socket = ref<Socket>()
  // Verified-anonymous state: set only when Foundry affirmatively reports the
  // session as unauthenticated (a session event without a userId, or an HTTP
  // /join that renders the login form) — never on a mere timeout.
  const needsLogin = ref(false)
  const isConnected = ref(false)
  const sessionReady = ref(false)
  const connectionError = ref('')
  let connectionId = 0
  let sessionWatchdog: ReturnType<typeof setTimeout> | undefined
  let stalledHandshakeRetries = 0
  let lastAttemptOrigin: string | undefined

  let sessionHooks: SessionHooks = {}
  function registerSessionHooks(hooks: SessionHooks) {
    sessionHooks = hooks
  }

  // Automatic-repair machinery (backoff, in-flight dedup) lives in the policy;
  // it drives connectToServer through the injected callback, and reads the
  // active URL live so a server the user has left can never be reconnected to.
  const reconnectPolicy = createReconnectPolicy({
    activeUrl: () => activeServerUrl(),
    connect: (url) => connectToServer(url)
  })
  const requestReconnect = reconnectPolicy.requestReconnect

  function currentTransport(): ServerTransport {
    return getServerTransport(useServerAddressStore().isNativeMobile)
  }

  // The active server lives in the serverAddress store (the single source of
  // truth that useSession watches to drive connectToServer). Read it here
  // rather than mirroring it locally, so a server the user has left can never
  // be silently reconnected to from a stale copy.
  function activeServerUrl(): URL | undefined {
    return useServerAddressStore().serverUrl
  }

  function clearSessionWatchdog() {
    if (sessionWatchdog === undefined) return
    clearTimeout(sessionWatchdog)
    sessionWatchdog = undefined
  }

  function disconnectCurrentSocket() {
    clearSessionWatchdog()
    socket.value?.removeAllListeners()
    socket.value?.disconnect()
    socket.value = undefined
    isConnected.value = false
    sessionReady.value = false
  }

  function clearConnectionError() {
    connectionError.value = ''
  }

  // Tear down the socket and abandon any in-flight connection attempt or
  // scheduled retry. Bumping connectionId invalidates a pending connectToServer
  // so a late-arriving socket can't yank the user back out of the gate. Used
  // when the user cancels a stuck connection to return to the ServerUrlGate.
  function disconnect() {
    connectionId += 1
    reconnectPolicy.cancel()
    disconnectCurrentSocket()
    needsLogin.value = false
    connectionError.value = ''
    stalledHandshakeRetries = 0
    lastAttemptOrigin = undefined
  }

  function currentSocket(): Socket | undefined {
    return socket.value?.connected ? socket.value : undefined
  }

  function getSocket(timeoutMs = GET_SOCKET_TIMEOUT_MS): Promise<Socket> {
    const connected = currentSocket()
    if (connected) {
      logger.debug('TM-DIAG getSocket: reusing live socket', {
        id: connected.id,
        sessionReady: sessionReady.value
      })
      return Promise.resolve(connected)
    }
    logger.debug('TM-DIAG getSocket: no live socket, waiting', {
      hasSocket: !!socket.value,
      connected: socket.value?.connected
    })
    return new Promise((resolve, reject) => {
      const existingSocket = socket.value
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Socket not available'))
      }, timeoutMs)
      const stop = watch(socket, (s) => {
        if (s?.connected) {
          resolveSocket(s)
        }
      })

      function cleanup() {
        clearTimeout(timer)
        stop?.()
        existingSocket?.off('connect', onExistingSocketConnect)
      }
      function resolveSocket(s: Socket) {
        cleanup()
        resolve(s)
      }
      function onExistingSocketConnect() {
        if (existingSocket?.connected) resolveSocket(existingSocket)
      }

      if (existingSocket) existingSocket.once('connect', onExistingSocketConnect)
    })
  }

  async function getJoinData(): Promise<JoinData> {
    // Bound the socket wait to the same budget as the emit itself. Without
    // this, a missing socket makes each "3-second" attempt silently inherit
    // getSocket's 15s default — three attempts meant the login page could sit
    // on "loading users" for the better part of a minute before the HTTP
    // fallback even ran.
    const socketJoinData = async () =>
      emitWithRetries<JoinData>(
        () => getSocket(JOIN_DATA_TIMEOUT_MS),
        'getJoinData',
        JOIN_DATA_TIMEOUT_MS,
        JOIN_DATA_RETRY_ATTEMPTS
      )

    const url = activeServerUrl()
    if (!url) throw new Error('Server URL not available')
    return currentTransport().getJoinData(url, socketJoinData)
  }

  // Resolve a user-typed address into a reachable URL. When no protocol was
  // typed we probe https first, then http, and only report failure if neither
  // answers. An explicit protocol is trusted as-is (the socket connection
  // itself surfaces any connectivity problem, as before).
  async function resolveServerUrl(
    input: string
  ): Promise<{ ok: true; url: URL } | { ok: false; reason: 'invalid' | 'unreachable' }> {
    let candidates: URL[]
    try {
      candidates = serverUrlCandidates(input)
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    if (candidates.length === 1) return { ok: true, url: candidates[0] }
    const transport = currentTransport()
    for (const candidate of candidates) {
      if (await transport.probe(candidate)) return { ok: true, url: candidate }
    }
    return { ok: false, reason: 'unreachable' }
  }

  // Reachability check for an already-normalized server URL — used by the
  // gate to give immediate feedback on a saved-server selection instead of
  // committing to a server that can't be reached.
  function probeServer(url: URL): Promise<boolean> {
    return currentTransport().probe(url)
  }

  // The login user remembered for the active server (empty if none), used to
  // prefill the login page's user dropdown.
  function rememberedLoginUser(): string {
    const url = activeServerUrl()
    return url ? lastLoginUser(url.origin) : ''
  }

  function handleAuthFailure() {
    needsLogin.value = true
  }

  async function login(userid: string, password: string, name?: string): Promise<boolean> {
    const url = activeServerUrl()
    if (!url) return false
    if (!(await currentTransport().verifyCredentials(url, userid, password))) return false
    rememberLoginUser(url.origin, userid, name)
    try {
      await connectToServer(url)
      needsLogin.value = false
    } catch {
      return false
    }
    return true
  }

  // Round-trip a cheap ack-bearing emit with a short timeout. The socket.io
  // client's `connected` flag can lag behind reality (the underlying TCP/
  // websocket may be dead after a long PWA backgrounding without the client
  // having noticed yet), so an explicit probe is the only reliable check.
  // `getJoinData` already supports an ack callback server-side and has no
  // side effects, so it's a safe heartbeat.
  async function probeConnection(timeoutMs = PROBE_CONNECTION_TIMEOUT_MS): Promise<boolean> {
    const s = socket.value
    if (!s || !s.connected) return false
    return emitWithTimeout(s, 'getJoinData', timeoutMs).then(
      () => true,
      () => false
    )
  }

  // The session event didn't arrive in time. A timeout alone doesn't mean the
  // user is logged out — Foundry may still be loading a world, or the socket's
  // Foundry-side handshake may have silently stalled (the classic "restart the
  // app and it works" state). Ask the server over plain HTTP whether the
  // stored session is authenticated and route accordingly; only a confirmed
  // anonymous session goes to the login page directly.
  async function resolveStalledHandshake(epoch: number, url: URL) {
    logger.debug('TM-INIT: session event did not arrive — probing session over HTTP')
    const authenticated = await currentTransport()
      .sessionIsAuthenticated(url)
      .catch(() => undefined)
    if (epoch !== connectionId) return
    logger.debug('TM-DIAG stalled handshake verdict', {
      authenticated,
      retries: stalledHandshakeRetries
    })
    if (authenticated !== false && stalledHandshakeRetries < MAX_STALLED_HANDSHAKE_RETRIES) {
      // Session valid (or unverifiable): a fresh socket — exactly what
      // relaunching the app does — is the cure, not the login page.
      stalledHandshakeRetries += 1
      void requestReconnect()
    } else {
      // Confirmed anonymous, or fresh sockets keep stalling: show the login
      // page rather than spinning forever. A late session event still wins —
      // its handler clears needsLogin.
      handleAuthFailure()
    }
  }

  // Watchdog: if Foundry's session event doesn't arrive shortly after a
  // (re)connect, disambiguate over HTTP (see resolveStalledHandshake) instead
  // of camping on a spinner. Cleared by the session handler on the first valid
  // handshake; re-armed on every connect, including socket.io's internal soft
  // reconnects (which previously got no watchdog at all).
  function armSessionWatchdog(epoch: number, url: URL) {
    clearSessionWatchdog()
    sessionWatchdog = setTimeout(() => {
      if (epoch !== connectionId) return
      void resolveStalledHandshake(epoch, url)
    }, SESSION_WATCHDOG_TIMEOUT_MS)
  }

  // Attached synchronously at socket creation (before the connection is
  // awaited) so a fast server can't emit `session` into the void. Every
  // handler is epoch-guarded: a socket that loses the connectionId race is
  // inert even before its establishSocket promise settles.
  function attachSocketHandlers(s: Socket, epoch: number, url: URL) {
    s.onAny((name, ...args) => {
      if (name === 'userActivity' || (name.match('module.') && !name.match(TM.CHANNEL))) return
      logger.debug('TM-RECV', name, ...args)
    })
    s.onAnyOutgoing((name, ...args) => {
      logger.debug('TM-SEND', name, ...args)
    })
    s.on('disconnect', (reason) => {
      if (epoch !== connectionId) return
      logger.debug('TM-DIAG socket disconnect', reason)
      isConnected.value = false
      sessionReady.value = false
    })
    s.on('connect', () => {
      if (epoch !== connectionId) return
      logger.debug('TM-DIAG socket (re)connect', { id: s.id })
      isConnected.value = true
      sessionReady.value = false
      armSessionWatchdog(epoch, url)
    })
    s.on('session', (args: { userId: string }) => {
      logger.debug('TM-DIAG session event', {
        userId: args?.userId,
        stale: epoch !== connectionId
      })
      if (epoch !== connectionId) return
      clearSessionWatchdog()
      if (args?.userId) {
        const userStore = useUserStore()
        // A different user id means we've switched servers (or re-logged as
        // someone else). Let the wiring drop identity-scoped state (the
        // last-known world) before sessionReady flips; a same-user reconnect
        // skips this for a seamless resume. See serverEventWiring.
        if (userStore.getUserId() && userStore.getUserId() !== args.userId) {
          sessionHooks.onUserChanged?.()
        }
        userStore.setUserId(args.userId)
        sessionReady.value = true
        needsLogin.value = false
        stalledHandshakeRetries = 0
        reconnectPolicy.resetBackoff()
        // Downstream refreshes (world data, character re-sync) fire on every
        // session handshake via the wiring hook — including socket.io's
        // internal soft reconnects, which don't replace socket.value and
        // therefore don't trip useSession's socket-watch.
        sessionHooks.onSessionAuthenticated?.()
      } else {
        sessionReady.value = false
        handleAuthFailure()
      }
    })
  }

  // `userInitiated` marks connects the user explicitly asked for (picking a
  // server in the gate): their failures surface connectionError immediately so
  // the gate can show it. Automatic connects (cold start, resume, repairs)
  // never set connectionError — they retry quietly on a backoff so a transient
  // network wobble can't bounce the user off their cached sheet.
  async function connectToServer(
    url: URL,
    opts: { userInitiated?: boolean } = {}
  ): Promise<Socket> {
    connectionError.value = ''
    const thisConnectionId = ++connectionId
    reconnectPolicy.clearRetryTimer()
    disconnectCurrentSocket()
    sessionReady.value = false
    // A different server invalidates the previous one's verified login state
    // and repair budgets.
    if (lastAttemptOrigin !== url.origin) {
      needsLogin.value = false
      stalledHandshakeRetries = 0
      reconnectPolicy.resetBackoff()
    }
    lastAttemptOrigin = url.origin

    try {
      // The connect handler (attached pre-connect) owns flipping isConnected
      // and arming the session watchdog, so initial connects and socket.io's
      // internal reconnects follow the identical path.
      const newSocket = await establishSocket(url, currentTransport(), true, (s) =>
        attachSocketHandlers(s, thisConnectionId, url)
      )
      if (thisConnectionId !== connectionId) {
        newSocket.disconnect()
        throw new Error('Stale socket connection ignored')
      }
      logger.debug('TM-INIT: establishing socket connection')
      socket.value = newSocket
      isConnected.value = true
      reconnectPolicy.resetBackoff()
      return newSocket
    } catch (e) {
      logger.debug('Error loading socket: ', e)
      if (thisConnectionId === connectionId) {
        socket.value = undefined
        isConnected.value = false
        sessionReady.value = false
        if (opts.userInitiated) {
          connectionError.value = e instanceof Error ? e.message : 'Could not connect to server'
        } else {
          reconnectPolicy.scheduleRetry()
        }
      }
      throw e
    }
  }

  return {
    socket,
    needsLogin,
    isConnected,
    sessionReady,
    connectionError,
    clearConnectionError,
    disconnect,
    resolveServerUrl,
    probeServer,
    connectToServer,
    requestReconnect,
    probeConnection,
    getSocket,
    login,
    getJoinData,
    rememberedLoginUser,
    registerSessionHooks
  }
})
