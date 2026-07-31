import { describe, it, expect } from 'vitest'
import { classifyHomeRedirect, classifyJoinPost, homeUrl } from '@/api/serverTransport'

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

  // Foundry sends these as an un-localized plain-text 401. Each means the
  // stored password can never work again, so it gets discarded.
  it.each(['JOIN.ErrorInvalidPassword', 'JOIN.ErrorUserDoesNotExist', 'JOIN.ErrorBanned'])(
    'treats %s as a terminal rejection',
    (body) => {
      expect(classifyJoinPost(401, body)).toBe('rejected')
    }
  )

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
