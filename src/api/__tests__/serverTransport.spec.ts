import { describe, it, expect } from 'vitest'
import {
  classifyHomeRedirect,
  classifyJoinPost,
  homeUrl,
  joinRequestBody,
  sessionCookiePath
} from '@/api/serverTransport'

// These two classifiers are the whole basis on which the app decides between
// "keep the user on their sheet", "silently re-authenticate", and "throw them
// back to the login page". Both are pure, and both encode specifics of how
// Foundry's server answers, so they're pinned here rather than discovered in
// the field.

const SERVER = new URL('https://vtt.example.com/')

describe('homeUrl', () => {
  // Load-bearing: Foundry's GET /join handler calls sessions.logoutWorld before
  // rendering, so probing there signs the user out. The probe must ask the home
  // route, which only redirects.
  it('probes the home route, never /join', () => {
    expect(homeUrl(SERVER).pathname).toBe('/')
  })
})

describe('classifyHomeRedirect', () => {
  it('reads a redirect to /game as authenticated', () => {
    expect(classifyHomeRedirect('/game', SERVER)).toBe(true)
    expect(classifyHomeRedirect('https://vtt.example.com/game', SERVER)).toBe(true)
  })

  it('reads a redirect to /join as anonymous', () => {
    expect(classifyHomeRedirect('/join', SERVER)).toBe(false)
    expect(classifyHomeRedirect('https://vtt.example.com/join', SERVER)).toBe(false)
  })

  it('tolerates a Foundry route prefix', () => {
    expect(classifyHomeRedirect('/foundry/game', SERVER)).toBe(true)
    expect(classifyHomeRedirect('/foundry/join', SERVER)).toBe(false)
  })

  // /setup and /license mean no world / unsigned EULA. Neither says anything
  // about the session, and guessing would cost the user their login.
  it('returns unknown for anything that is not /game or /join', () => {
    expect(classifyHomeRedirect('/setup', SERVER)).toBeUndefined()
    expect(classifyHomeRedirect('/license', SERVER)).toBeUndefined()
    expect(classifyHomeRedirect(undefined, SERVER)).toBeUndefined()
    expect(classifyHomeRedirect('', SERVER)).toBeUndefined()
    // No redirect at all — the request landed on / itself.
    expect(classifyHomeRedirect('https://vtt.example.com/', SERVER)).toBeUndefined()
  })
})

describe('sessionCookiePath', () => {
  // Foundry v14 authenticates the socket from the Cookie header only (it no
  // longer reads the ?session= query param v13 took), and the app's WebView is
  // a different site from the server, so the cookie needs SameSite=None to ride
  // the handshake — plus Secure, without which Chromium rejects SameSite=None.
  // Verified against a live v14 server: drop either attribute and the handshake
  // reports `session: null` and getJoinData never acks.
  it('marks an https session cookie SameSite=None; Secure', () => {
    expect(sessionCookiePath(new URL('https://vtt.example.com/'))).toBe('/; SameSite=None; Secure')
  })

  // Secure cookies aren't sent back over a plain connection, and SameSite=None
  // without Secure is refused, so there is no attribute combination that works
  // for http — it stays a bare path rather than a cookie the browser discards.
  it('leaves an http session cookie a bare path', () => {
    expect(sessionCookiePath(new URL('http://192.168.1.10:30000/'))).toBe('/')
  })
})

describe('classifyJoinPost', () => {
  it('accepts Foundry’s success body', () => {
    const body = JSON.stringify({
      request: 'join',
      status: 'success',
      message: 'JOIN.LoginSuccess',
      redirect: '/game'
    })
    expect(classifyJoinPost(200, body)).toBe('ok')
  })

  // A build that stops sending `status` but still says where to go next has
  // still logged us in — Foundry answers a *failed* join with a non-2xx and a
  // plain-text error key, never with JSON.
  it('accepts a success body that has lost its status field', () => {
    expect(classifyJoinPost(200, JSON.stringify({ request: 'join', redirect: '/game' }))).toBe('ok')
  })

  // Foundry sends these as an un-localized plain-text 401. Each one proves the
  // server resolved the user and refused them, so the stored password can never
  // work again and gets discarded.
  it.each(['JOIN.ErrorInvalidPassword', 'JOIN.ErrorBanned'])(
    'treats %s as a terminal rejection',
    (body) => {
      expect(classifyJoinPost(401, body)).toBe('rejected')
    }
  )

  // The 14.367 lockout: Foundry answers a request whose user field it didn't
  // understand exactly as it answers a deleted user. Reading that as terminal
  // deleted every saved password on a server upgrade, so it must stay transient
  // — the login page can handle a user who really is gone.
  it('treats JOIN.ErrorUserDoesNotExist as transient, not a bad credential', () => {
    expect(classifyJoinPost(401, 'JOIN.ErrorUserDoesNotExist')).toBe('unavailable')
  })

  // The critical asymmetry: a transient failure must never be read as a bad
  // password, or a good credential is thrown away and the user is back to
  // typing it. Unrecognized refusals therefore lean transient.
  it('treats transient and unrecognized failures as unavailable', () => {
    // Clears once the GM finishes setup.
    expect(classifyJoinPost(401, 'JOIN.WorldPendingSetup')).toBe('unavailable')
    expect(classifyJoinPost(401, 'Some future Foundry error')).toBe('unavailable')
    expect(classifyJoinPost(500, 'Internal Server Error')).toBe('unavailable')
    expect(classifyJoinPost(502, '')).toBe('unavailable')
  })

  // Foundry answers a join POST with no active world by rendering an HTML
  // error page at 200 — success status, but nobody got logged in.
  it('does not mistake a 2xx non-JSON page for success', () => {
    expect(classifyJoinPost(200, '<!DOCTYPE html><title>No Active Game</title>')).toBe(
      'unavailable'
    )
    expect(classifyJoinPost(200, JSON.stringify({ status: 'failed' }))).toBe('unavailable')
  })
})

describe('joinRequestBody', () => {
  // Foundry's server read `req.body.userid` through v14 build 364 and reads
  // `req.body.userId` from 14.367 on. Both ignore body keys they don't know, so
  // the request carries both spellings rather than betting on one — sending
  // only `userid` to a 14.367 server is the whole 14.367 login outage.
  it('sends the user id under both spellings Foundry has used', () => {
    expect(joinRequestBody('abc123', 'hunter2')).toEqual({
      action: 'join',
      userid: 'abc123',
      userId: 'abc123',
      password: 'hunter2'
    })
  })
})
