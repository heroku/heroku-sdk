/* eslint-disable camelcase, perfectionist/sort-objects -- tests preserve legacy wire payload field order */
import type {
  Team,
  TeamFeature,
  TeamInvitation,
  TeamMember,
} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {teamMemberExtensions} from './index.js'
import {listWithInvitations} from './list-with-invitations.js'

const INVITATIONS_ACCEPT = 'application/vnd.heroku+json; version=3.team-invitations'
const SDK_ACCEPT = 'application/vnd.heroku+json; version=3.sdk'

type TestPlatform = {
  team: {info: (teamIdentity: string) => Promise<Team>}
  teamFeature: {list: (teamIdentity: string) => Promise<TeamFeature[]>}
  teamInvitation: {list: (teamIdentity: string) => Promise<TeamInvitation[]>}
  teamMember: {list: (teamIdentity: string) => Promise<TeamMember[]>}
  withHeaders: (headers: Record<string, string>) => TestPlatform
  withOptions: (options: {signal: AbortSignal}) => TestPlatform
}

type TestCtxOptions = {
  features?: TeamFeature[]
  invitations?: TeamInvitation[]
  members?: TeamMember[]
  operationSignal?: AbortSignal
  team?: Team
  teamFeatureList?: (teamIdentity: string) => Promise<TeamFeature[]>
  teamInfo?: (teamIdentity: string) => Promise<Team>
  teamInvitationList?: (teamIdentity: string) => Promise<TeamInvitation[]>
  teamMemberList?: (teamIdentity: string) => Promise<TeamMember[]>
}

function makeTeam(type: Team['type'] = 'team'): Team {
  return {type} as Team
}

function makeMember(email: string, role: TeamMember['role'] = 'member'): TeamMember {
  return {
    created_at: 'member-created',
    email,
    federated: true,
    role,
    two_factor_authentication: true,
    updated_at: 'member-updated',
  }
}

function makeInvitation(email: string, role: TeamInvitation['role'] = 'member'): TeamInvitation {
  return {
    created_at: 'invite-created',
    id: 'invitation-id-not-copied',
    invited_by: {email: 'inviter@example.com', id: 'inviter-id', name: 'Inviter'},
    role,
    team: {id: 'team-id', name: 'team-name'},
    updated_at: 'invite-updated',
    user: {email, id: 'user-id', name: 'Invitee'},
  }
}

function buildCtx(options: TestCtxOptions = {}) {
  const calls: string[] = []
  const requestSignals: Array<AbortSignal | undefined> = []
  const requestHeaders: Array<Record<string, string>> = []
  const withHeadersCalls: Array<Record<string, string>> = []
  const invitationRequestHeaders: Array<Record<string, string>> = []
  const optionCalls: Array<{signal: AbortSignal}> = []
  const team = options.team ?? makeTeam()
  const features = options.features ?? [{name: 'team-invite-acceptance', enabled: true} as TeamFeature]
  const invitations = options.invitations ?? [makeInvitation('invite@example.com')]
  const members = options.members ?? [makeMember('member@example.com')]

  const teamInfo = options.teamInfo ?? vi.fn(async () => team)
  const teamFeatureList = options.teamFeatureList ?? vi.fn(async () => features)
  const teamInvitationList = options.teamInvitationList ?? vi.fn(async () => invitations)
  const teamMemberList = options.teamMemberList ?? vi.fn(async () => members)

  const makePlatform = (signal?: AbortSignal, headers?: Record<string, string>): TestPlatform => {
    const beforeRequest = (name: string) => {
      calls.push(name)
      requestSignals.push(signal)
      requestHeaders.push(headers ?? {})
      if (name === 'teamInvitation.list') invitationRequestHeaders.push(headers ?? {})
      signal?.throwIfAborted()
    }

    return {
      team: {
        async info(teamIdentity: string) {
          beforeRequest('team.info')
          return teamInfo(teamIdentity)
        },
      },
      teamFeature: {
        async list(teamIdentity: string) {
          beforeRequest('teamFeature.list')
          return teamFeatureList(teamIdentity)
        },
      },
      teamInvitation: {
        async list(teamIdentity: string) {
          beforeRequest('teamInvitation.list')
          return teamInvitationList(teamIdentity)
        },
      },
      teamMember: {
        async list(teamIdentity: string) {
          beforeRequest('teamMember.list')
          return teamMemberList(teamIdentity)
        },
      },
      withHeaders(nextHeaders: Record<string, string>) {
        withHeadersCalls.push(nextHeaders)
        return makePlatform(signal, {...headers, ...nextHeaders})
      },
      withOptions(nextOptions: {signal: AbortSignal}) {
        optionCalls.push(nextOptions)
        return makePlatform(nextOptions.signal, headers)
      },
    }
  }

  const ctx = {
    operationSignal: options.operationSignal,
    platform: makePlatform() as never,
  } as Pick<ResourceCtx, 'operationSignal' | 'platform'>

  return {
    calls,
    ctx,
    invitationRequestHeaders,
    optionCalls,
    requestHeaders,
    requestSignals,
    teamFeatureList,
    teamInfo,
    teamInvitationList,
    teamMemberList,
    withHeadersCalls,
  }
}

describe('listWithInvitations', () => {
  it('reads team, enabled feature, invitations, and members in order', async () => {
    const {
      calls,
      ctx,
      invitationRequestHeaders,
      optionCalls,
      requestHeaders,
      teamFeatureList,
      teamInfo,
      teamInvitationList,
      teamMemberList,
      withHeadersCalls,
    } = buildCtx()

    const rows = await listWithInvitations(ctx, 'team-name')

    expect(calls).toEqual(['team.info', 'teamFeature.list', 'teamInvitation.list', 'teamMember.list'])
    expect(teamInfo).toHaveBeenCalledExactlyOnceWith('team-name')
    expect(teamFeatureList).toHaveBeenCalledExactlyOnceWith('team-name')
    expect(teamInvitationList).toHaveBeenCalledExactlyOnceWith('team-name')
    expect(teamMemberList).toHaveBeenCalledExactlyOnceWith('team-name')
    expect(withHeadersCalls).toEqual([{Accept: INVITATIONS_ACCEPT}])
    expect(invitationRequestHeaders).toEqual([{Accept: INVITATIONS_ACCEPT}])
    expect(requestHeaders).toEqual([{}, {}, {Accept: INVITATIONS_ACCEPT}, {}])
    expect(optionCalls).toEqual([])
    expect(rows.map(({email}) => email)).toEqual(['invite@example.com', 'member@example.com'])
  })

  it.each([
    ['disabled', [{enabled: false, name: 'team-invite-acceptance'} as TeamFeature]],
    ['missing', [{enabled: true, name: 'other-feature'} as TeamFeature]],
  ] as Array<[string, TeamFeature[]]>)('skips invitations when the team invite feature is %s', async (_name, features) => {
    const {calls, ctx, teamInvitationList} = buildCtx({features})

    const rows = await listWithInvitations(ctx, 'team-name')

    expect(calls).toEqual(['team.info', 'teamFeature.list', 'teamMember.list'])
    expect(teamInvitationList).not.toHaveBeenCalled()
    expect(rows.map(({email}) => email)).toEqual(['member@example.com'])
  })

  it('skips feature and invitation reads for enterprise teams', async () => {
    const {calls, ctx, teamFeatureList, teamInvitationList} = buildCtx({team: makeTeam('enterprise')})

    const rows = await listWithInvitations(ctx, 'enterprise-name')

    expect(calls).toEqual(['team.info', 'teamMember.list'])
    expect(teamFeatureList).not.toHaveBeenCalled()
    expect(teamInvitationList).not.toHaveBeenCalled()
    expect(rows.map(({email}) => email)).toEqual(['member@example.com'])
  })

  it('propagates team lookup failures without making later reads', async () => {
    const error = Object.assign(new Error('team not found'), {statusCode: 404})
    const teamInfo = vi.fn().mockRejectedValue(error)
    const {calls, ctx, teamFeatureList, teamInvitationList, teamMemberList} = buildCtx({teamInfo})

    await expect(listWithInvitations(ctx, 'missing-team')).rejects.toBe(error)

    expect(calls).toEqual(['team.info'])
    expect(teamFeatureList).not.toHaveBeenCalled()
    expect(teamInvitationList).not.toHaveBeenCalled()
    expect(teamMemberList).not.toHaveBeenCalled()
  })

  it.each([
    ['team features', 'teamFeature.list'],
    ['invitations', 'teamInvitation.list'],
    ['members', 'teamMember.list'],
  ] as const)('propagates %s read failures unchanged and stops subsequent reads', async (_read, failingCall) => {
    const error = new Error(`${failingCall} failed`)
    const teamFeatureList = vi.fn(async () => {
      if (failingCall === 'teamFeature.list') throw error
      return [{enabled: true, name: 'team-invite-acceptance'} as TeamFeature]
    })
    const teamInvitationList = vi.fn(async () => {
      if (failingCall === 'teamInvitation.list') throw error
      return [makeInvitation('invite@example.com')]
    })
    const teamMemberList = vi.fn(async () => {
      if (failingCall === 'teamMember.list') throw error
      return [makeMember('member@example.com')]
    })
    const {calls, ctx} = buildCtx({teamFeatureList, teamInvitationList, teamMemberList})

    await expect(listWithInvitations(ctx, 'team-name')).rejects.toBe(error)

    const expectedCalls = ['team.info', 'teamFeature.list']
    if (failingCall !== 'teamFeature.list') expectedCalls.push('teamInvitation.list')
    if (failingCall === 'teamMember.list') expectedCalls.push('teamMember.list')
    expect(calls).toEqual(expectedCalls)
  })

  it('returns copied members and exact invitation rows, sorted without deduplication or input mutation', async () => {
    const existing = Object.freeze({
      ...makeMember('same@example.com', null),
      status: 'preexisting-status',
    })
    const lastMember = Object.freeze(makeMember('z@example.com'))
    const normalInvitation = Object.freeze(makeInvitation('same@example.com', 'owner'))
    const mutableInvitationWithMissingFields = makeInvitation('ignored@example.com', null)
    Reflect.deleteProperty(mutableInvitationWithMissingFields, 'user')
    mutableInvitationWithMissingFields.created_at = ''
    mutableInvitationWithMissingFields.updated_at = ''
    const invitationWithMissingFields = Object.freeze(mutableInvitationWithMissingFields)
    const members = [lastMember, existing]
    Object.freeze(members)
    const {ctx} = buildCtx({
      invitations: [normalInvitation, invitationWithMissingFields],
      members,
    })

    const rows = await listWithInvitations(ctx, 'team-name')

    expect(rows.map(({email}) => email)).toEqual(['', 'same@example.com', 'same@example.com', 'z@example.com'])
    expect(rows.filter(({email}) => email === 'same@example.com')).toHaveLength(2)
    expect(rows[1]).toEqual({...existing, status: ''})
    expect(rows[1]).not.toBe(existing)
    expect(Object.keys(rows[2])).toEqual([
      'email', 'role', 'status', 'federated', 'user', 'two_factor_authentication', 'created_at', 'updated_at',
    ])
    expect(rows[2]).toEqual({
      email: 'same@example.com',
      role: 'owner',
      status: 'pending',
      federated: false,
      user: normalInvitation.user,
      two_factor_authentication: false,
      created_at: 'invite-created',
      updated_at: 'invite-updated',
    })
    expect(rows[0]).toEqual({
      email: '',
      role: null,
      status: 'pending',
      federated: false,
      user: undefined,
      two_factor_authentication: false,
      created_at: '',
      updated_at: '',
    })
    expect(existing.status).toBe('preexisting-status')
    expect(lastMember.email).toBe('z@example.com')
    expect(members).toEqual([lastMember, existing])
    expect(members[0]).toBe(lastMember)
    expect(members[1]).toBe(existing)
  })

  it('passes per-call cancellation to reads and stops after cancellation during a read', async () => {
    const operationController = new AbortController()
    const callController = new AbortController()
    const teamInfo = vi.fn(async () => {
      operationController.abort()
      return makeTeam()
    })
    const {calls, ctx, optionCalls, teamFeatureList, requestSignals} = buildCtx({
      operationSignal: operationController.signal,
      teamInfo,
    })

    await expect(listWithInvitations(ctx, 'team-name', {signal: callController.signal})).rejects.toThrow()

    expect(optionCalls).toHaveLength(1)
    expect(optionCalls[0].signal).not.toBe(operationController.signal)
    expect(optionCalls[0].signal).not.toBe(callController.signal)
    expect(requestSignals).toEqual([optionCalls[0].signal])
    expect(calls).toEqual(['team.info'])
    expect(teamFeatureList).not.toHaveBeenCalled()
  })

  it('throws for an already-aborted signal before making a request', async () => {
    const controller = new AbortController()
    controller.abort()
    const {calls, ctx, optionCalls} = buildCtx()

    await expect(listWithInvitations(ctx, 'team-name', {signal: controller.signal})).rejects.toThrow()

    expect(calls).toEqual([])
    expect(optionCalls).toEqual([])
  })

  it.each([
    ['feature', 'teamFeature.list'],
    ['invitation', 'teamInvitation.list'],
  ] as const)('stops before the next read if cancellation occurs during the %s request', async (_read, abortAfter) => {
    const controller = new AbortController()
    const teamFeatureList = vi.fn(async () => {
      if (abortAfter === 'teamFeature.list') controller.abort()
      return [{enabled: true, name: 'team-invite-acceptance'} as TeamFeature]
    })
    const teamInvitationList = vi.fn(async () => {
      if (abortAfter === 'teamInvitation.list') controller.abort()
      return [makeInvitation('invite@example.com')]
    })
    const {calls, ctx} = buildCtx({teamFeatureList, teamInvitationList})

    await expect(listWithInvitations(ctx, 'team-name', {signal: controller.signal})).rejects.toThrow()

    const expectedCalls = ['team.info', 'teamFeature.list']
    if (abortAfter === 'teamInvitation.list') expectedCalls.push('teamInvitation.list')
    expect(calls).toEqual(expectedCalls)
  })

  it('uses exact API routes and scopes the invitation Accept header to the invitation request', async () => {
    const requests: Request[] = []
    const bodies: unknown[] = [
      {type: 'team'},
      [{enabled: true, name: 'team-invite-acceptance'}],
      [makeInvitation('invite@example.com')],
      [makeMember('member@example.com')],
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      const body = bodies.shift()
      if (body === undefined) throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
    })
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [teamMemberExtensions] as const})

    await sdk.platform.teamMember.listWithInvitations('example-team')

    expect(requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /teams/example-team',
      'GET /teams/example-team/features',
      'GET /teams/example-team/invitations',
      'GET /teams/example-team/members',
    ])
    expect(requests.map(request => request.headers.get('accept'))).toEqual([
      SDK_ACCEPT, SDK_ACCEPT, INVITATIONS_ACCEPT, SDK_ACCEPT,
    ])
  })

  it('aborts an in-flight prerequisite request and does not make later reads', async () => {
    const controller = new AbortController()
    const requests: Request[] = []
    let resolveFeatureRequest!: (request: Request) => void
    const featureRequestReceived = new Promise<Request>(resolve => {
      resolveFeatureRequest = resolve
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)

      const {pathname} = new URL(request.url)
      if (pathname === '/teams/example-team') {
        return new Response(JSON.stringify({type: 'team'}), {
          headers: {'content-type': 'application/json'},
        })
      }

      if (pathname === '/teams/example-team/features') {
        resolveFeatureRequest(request)
        return new Promise<Response>((_resolve, reject) => {
          const rejectOnAbort = () => {
            clearTimeout(timeout)
            reject(request.signal.reason)
          }

          const timeout = setTimeout(() => {
            request.signal.removeEventListener('abort', rejectOnAbort)
            reject(new Error('Timed out waiting for request abort'))
          }, 1000)
          if (request.signal.aborted) {
            rejectOnAbort()
            return
          }

          request.signal.addEventListener('abort', rejectOnAbort, {once: true})
        })
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [teamMemberExtensions] as const})

    const pending = sdk.platform.teamMember.listWithInvitations('example-team', {signal: controller.signal})
    const request = await featureRequestReceived
    controller.abort()

    await expect(pending).rejects.toThrow()

    expect(request.signal.aborted).toBe(true)
    expect(requests.map(({url}) => new URL(url).pathname)).toEqual([
      '/teams/example-team',
      '/teams/example-team/features',
    ])
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
/* eslint-enable camelcase, perfectionist/sort-objects */
