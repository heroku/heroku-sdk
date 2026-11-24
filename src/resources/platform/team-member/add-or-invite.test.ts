/* eslint-disable camelcase, perfectionist/sort-objects -- preserve API request and response field order */
import type {
  Team,
  TeamFeature,
  TeamInvitation,
  TeamInvitationCreateOpts,
  TeamMember,
  TeamMemberCreateOrUpdateOpts,
} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {addOrInvite, teamMemberExtensions} from './index.js'

const INVITATIONS_ACCEPT = 'application/vnd.heroku+json; version=3.team-invitations'
const SDK_ACCEPT = 'application/vnd.heroku+json; version=3.sdk'

type TestPlatform = {
  team: {info: (teamIdentity: string) => Promise<Team>}
  teamFeature: {list: (teamIdentity: string) => Promise<TeamFeature[]>}
  teamInvitation: {create: (teamIdentity: string, body: TeamInvitationCreateOpts) => Promise<TeamInvitation>}
  teamMember: {createOrUpdate: (teamIdentity: string, body: TeamMemberCreateOrUpdateOpts) => Promise<TeamMember>}
  withHeaders: (headers: Record<string, string>) => TestPlatform
  withOptions: (options: {signal: AbortSignal}) => TestPlatform
}

type TestCtxOptions = {
  createInvitation?: (teamIdentity: string, body: TeamInvitationCreateOpts) => Promise<TeamInvitation>
  createMember?: (teamIdentity: string, body: TeamMemberCreateOrUpdateOpts) => Promise<TeamMember>
  features?: TeamFeature[]
  operationSignal?: AbortSignal
  team?: Team
  teamFeatureList?: (teamIdentity: string) => Promise<TeamFeature[]>
  teamInfo?: (teamIdentity: string) => Promise<Team>
}

function makeTeam(type: Team['type'] = 'team'): Team {
  return {type} as Team
}

function makeInvitation(email = 'invite@example.com'): TeamInvitation {
  return {id: 'invitation-id', role: 'owner', user: {email}} as TeamInvitation
}

function makeMember(email = 'member@example.com'): TeamMember {
  return {
    created_at: 'member-created',
    email,
    federated: false,
    role: 'member',
    two_factor_authentication: false,
    updated_at: 'member-updated',
  }
}

function buildCtx(options: TestCtxOptions = {}) {
  const calls: Array<{
    args: unknown[]
    headers: Record<string, string>
    name: string
    signal?: AbortSignal
  }> = []
  const withHeadersCalls: Array<Record<string, string>> = []
  const optionCalls: Array<{signal: AbortSignal}> = []
  const team = options.team ?? makeTeam()
  const features = options.features ?? [{name: 'team-invite-acceptance', enabled: true} as TeamFeature]

  const teamInfo = options.teamInfo ?? vi.fn(async () => team)
  const teamFeatureList = options.teamFeatureList ?? vi.fn(async () => features)
  const createInvitation = options.createInvitation ?? vi.fn(async () => makeInvitation())
  const createMember = options.createMember ?? vi.fn(async () => makeMember())

  const makePlatform = (signal?: AbortSignal, headers: Record<string, string> = {}): TestPlatform => {
    const record = (name: string, args: unknown[]) => {
      calls.push({
        args,
        headers,
        name,
        signal,
      })
      signal?.throwIfAborted()
    }

    return {
      team: {
        async info(teamIdentity) {
          record('team.info', [teamIdentity])
          return teamInfo(teamIdentity)
        },
      },
      teamFeature: {
        async list(teamIdentity) {
          record('teamFeature.list', [teamIdentity])
          return teamFeatureList(teamIdentity)
        },
      },
      teamInvitation: {
        async create(teamIdentity, body) {
          record('teamInvitation.create', [teamIdentity, body])
          return createInvitation(teamIdentity, body)
        },
      },
      teamMember: {
        async createOrUpdate(teamIdentity, body) {
          record('teamMember.createOrUpdate', [teamIdentity, body])
          return createMember(teamIdentity, body)
        },
      },
      withHeaders(nextHeaders) {
        withHeadersCalls.push(nextHeaders)
        return makePlatform(signal, {...headers, ...nextHeaders})
      },
      withOptions(nextOptions) {
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
    createInvitation,
    createMember,
    ctx,
    optionCalls,
    teamFeatureList,
    teamInfo,
    withHeadersCalls,
  }
}

describe('addOrInvite', () => {
  it('creates an invitation after reads and an awaited callback, preserving the raw role', async () => {
    const invitation = makeInvitation()
    const order: string[] = []
    let finishCallback!: () => void
    const callbackGate = new Promise<void>(resolve => {
      finishCallback = resolve
    })
    const beforeMutation = vi.fn(async ({kind}: {kind: 'invitation' | 'member'}) => {
      order.push(`beforeMutation:${kind}:start`)
      await callbackGate
      order.push('beforeMutation:done')
    })
    const createInvitation = vi.fn(async (_teamIdentity: string, _body: TeamInvitationCreateOpts) => {
      order.push('teamInvitation.create')
      return invitation
    })
    const {calls, createMember, ctx, withHeadersCalls} = buildCtx({createInvitation})
    const resultPromise = addOrInvite(ctx, 'team-name', 'person@example.com', 'custom-role', {beforeMutation})

    await vi.waitFor(() => expect(beforeMutation).toHaveBeenCalledOnce())
    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list'])
    finishCallback()
    const result = await resultPromise

    expect(order).toEqual(['beforeMutation:invitation:start', 'beforeMutation:done', 'teamInvitation.create'])
    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list', 'teamInvitation.create'])
    expect(calls[2].args).toEqual(['team-name', {email: 'person@example.com', role: 'custom-role'}])
    expect(calls.map(({headers}) => headers)).toEqual([{}, {}, {Accept: INVITATIONS_ACCEPT}])
    expect(withHeadersCalls).toEqual([{Accept: INVITATIONS_ACCEPT}])
    expect(createMember).not.toHaveBeenCalled()
    expect(result).toEqual({kind: 'invitation', invitation})
    expect(result.kind === 'invitation' && result.invitation).toBe(invitation)
  })

  it.each([
    ['disabled', [{enabled: false, name: 'team-invite-acceptance'} as TeamFeature]],
    ['missing', [{enabled: true, name: 'another-feature'} as TeamFeature]],
  ] as Array<[string, TeamFeature[]]>)('adds a member when the invitation feature is %s', async (_state, features) => {
    const member = makeMember()
    const beforeMutation = vi.fn()
    const createMember = vi.fn(async (_teamIdentity: string, _body: TeamMemberCreateOrUpdateOpts) => member)
    const {calls, createInvitation, ctx, withHeadersCalls} = buildCtx({createMember, features})

    const result = await addOrInvite(ctx, 'team-name', 'person@example.com', 'custom-role', {beforeMutation})

    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list', 'teamMember.createOrUpdate'])
    expect(calls[2].args).toEqual(['team-name', {email: 'person@example.com', role: 'custom-role'}])
    expect(calls.map(({headers}) => headers)).toEqual([{}, {}, {}])
    expect(withHeadersCalls).toEqual([])
    expect(beforeMutation).toHaveBeenCalledExactlyOnceWith({kind: 'member'})
    expect(createInvitation).not.toHaveBeenCalled()
    expect(result).toEqual({kind: 'member', member})
    expect(result.kind === 'member' && result.member).toBe(member)
  })

  it('skips the feature lookup for enterprise teams', async () => {
    const {calls, ctx, teamFeatureList} = buildCtx({team: makeTeam('enterprise')})

    const result = await addOrInvite(ctx, 'enterprise-name', 'person@example.com', 'owner')

    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamMember.createOrUpdate'])
    expect(teamFeatureList).not.toHaveBeenCalled()
    expect(result.kind).toBe('member')
  })

  it('propagates a team lookup failure without reading features or writing', async () => {
    const error = Object.assign(new Error('team not found'), {statusCode: 404})
    const teamInfo = vi.fn().mockRejectedValue(error)
    const {calls, createInvitation, createMember, ctx, teamFeatureList} = buildCtx({teamInfo})

    await expect(addOrInvite(ctx, 'missing-team', 'person@example.com', 'member')).rejects.toBe(error)

    expect(calls.map(({name}) => name)).toEqual(['team.info'])
    expect(teamFeatureList).not.toHaveBeenCalled()
    expect(createInvitation).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('propagates feature lookup failure without falling back to member creation', async () => {
    const error = new Error('features unavailable')
    const teamFeatureList = vi.fn().mockRejectedValue(error)
    const beforeMutation = vi.fn()
    const {calls, createInvitation, createMember, ctx} = buildCtx({teamFeatureList})

    await expect(addOrInvite(ctx, 'team-name', 'person@example.com', 'member', {beforeMutation})).rejects.toBe(error)

    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list'])
    expect(beforeMutation).not.toHaveBeenCalled()
    expect(createInvitation).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('propagates callback rejection and does not write', async () => {
    const error = new Error('confirmation rejected')
    const beforeMutation = vi.fn().mockRejectedValue(error)
    const {calls, createInvitation, createMember, ctx} = buildCtx({team: makeTeam('enterprise')})

    await expect(addOrInvite(ctx, 'enterprise-name', 'person@example.com', 'member', {beforeMutation})).rejects.toBe(error)

    expect(calls.map(({name}) => name)).toEqual(['team.info'])
    expect(beforeMutation).toHaveBeenCalledExactlyOnceWith({kind: 'member'})
    expect(createInvitation).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('propagates write failure unchanged', async () => {
    const error = new Error('invitation write failed')
    const createInvitation = vi.fn().mockRejectedValue(error)
    const {calls, ctx} = buildCtx({createInvitation})

    await expect(addOrInvite(ctx, 'team-name', 'person@example.com', 'owner')).rejects.toBe(error)

    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list', 'teamInvitation.create'])
  })

  it('propagates member write failure unchanged without retrying or inviting', async () => {
    const error = new Error('member write failed')
    const createMember = vi.fn().mockRejectedValue(error)
    const {calls, createInvitation, ctx} = buildCtx({
      createMember,
      features: [{enabled: false, name: 'team-invite-acceptance'} as TeamFeature],
    })

    await expect(addOrInvite(ctx, 'team-name', 'person@example.com', 'member')).rejects.toBe(error)

    expect(calls.map(({name}) => name)).toEqual(['team.info', 'teamFeature.list', 'teamMember.createOrUpdate'])
    expect(createMember).toHaveBeenCalledExactlyOnceWith('team-name', {email: 'person@example.com', role: 'member'})
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it.each(['operation', 'per-call'] as const)('combines %s cancellation and binds it to all requests', async source => {
    const operationController = new AbortController()
    const callController = new AbortController()
    const {calls, ctx, optionCalls} = buildCtx({operationSignal: operationController.signal})

    await addOrInvite(ctx, 'team-name', 'person@example.com', 'member', {signal: callController.signal})

    expect(optionCalls).toHaveLength(1)
    expect(optionCalls[0].signal).not.toBe(operationController.signal)
    expect(optionCalls[0].signal).not.toBe(callController.signal)
    expect(calls.map(({signal}) => signal)).toEqual([optionCalls[0].signal, optionCalls[0].signal, optionCalls[0].signal])

    const controller = source === 'operation' ? operationController : callController
    controller.abort()
    expect(optionCalls[0].signal.aborted).toBe(true)
  })

  it('does not write if cancellation occurs during the awaited callback', async () => {
    const controller = new AbortController()
    const beforeMutation = vi.fn(async () => controller.abort())
    const {calls, createInvitation, createMember, ctx} = buildCtx({team: makeTeam('enterprise')})

    await expect(addOrInvite(ctx, 'enterprise-name', 'person@example.com', 'member', {
      beforeMutation,
      signal: controller.signal,
    })).rejects.toThrow()

    expect(calls.map(({name}) => name)).toEqual(['team.info'])
    expect(beforeMutation).toHaveBeenCalledOnce()
    expect(createInvitation).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it.each([
    ['team', 'team.info'],
    ['feature', 'teamFeature.list'],
  ] as const)('stops after cancellation during the %s read', async (_read, cancelAfter) => {
    const controller = new AbortController()
    const teamInfo = vi.fn(async () => {
      if (cancelAfter === 'team.info') controller.abort()
      return makeTeam()
    })
    const teamFeatureList = vi.fn(async () => {
      if (cancelAfter === 'teamFeature.list') controller.abort()
      return [{enabled: true, name: 'team-invite-acceptance'} as TeamFeature]
    })
    const {calls, createInvitation, createMember, ctx} = buildCtx({teamFeatureList, teamInfo})

    await expect(addOrInvite(ctx, 'team-name', 'person@example.com', 'member', {signal: controller.signal})).rejects.toThrow()

    expect(calls.map(({name}) => name)).toEqual(cancelAfter === 'team.info'
      ? ['team.info']
      : ['team.info', 'teamFeature.list'])
    expect(createInvitation).not.toHaveBeenCalled()
    expect(createMember).not.toHaveBeenCalled()
  })

  it('throws for an already-aborted signal before making a request', async () => {
    const controller = new AbortController()
    controller.abort()
    const {calls, ctx, optionCalls} = buildCtx()

    await expect(addOrInvite(ctx, 'team-name', 'person@example.com', 'member', {signal: controller.signal})).rejects.toThrow()

    expect(calls).toEqual([])
    expect(optionCalls).toEqual([])
  })

  it('uses PUT invitation route and scopes its Accept header to the write request', async () => {
    const requests: Request[] = []
    const requestBodies: unknown[] = []
    const responseBodies = [
      {type: 'team'},
      [{enabled: true, name: 'team-invite-acceptance'}],
      {id: 'invitation-id', role: 'owner', user: {email: 'person@example.com'}},
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      if (request.method === 'PUT') requestBodies.push(await request.clone().json())
      const body = responseBodies.shift()
      if (body === undefined) throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
    })
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [teamMemberExtensions] as const})

    await sdk.platform.teamMember.addOrInvite('example-team', 'person@example.com', 'owner')

    expect(requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /teams/example-team',
      'GET /teams/example-team/features',
      'PUT /teams/example-team/invitations',
    ])
    expect(requests.map(request => request.headers.get('accept'))).toEqual([
      SDK_ACCEPT, SDK_ACCEPT, INVITATIONS_ACCEPT,
    ])
    expect(requestBodies).toEqual([{email: 'person@example.com', role: 'owner'}])
  })

  it('uses PUT member route and leaves the SDK Accept header unchanged', async () => {
    const requests: Request[] = []
    const requestBodies: unknown[] = []
    const responseBodies = [
      {type: 'enterprise'},
      {email: 'person@example.com', role: 'member'},
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      if (request.method === 'PUT') requestBodies.push(await request.clone().json())
      const body = responseBodies.shift()
      if (body === undefined) throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      return new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
    })
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [teamMemberExtensions] as const})

    await sdk.platform.teamMember.addOrInvite('example-team', 'person@example.com', 'member')

    expect(requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /teams/example-team',
      'PUT /teams/example-team/members',
    ])
    expect(requests.map(request => request.headers.get('accept'))).toEqual([SDK_ACCEPT, SDK_ACCEPT])
    expect(requestBodies).toEqual([{email: 'person@example.com', role: 'member'}])
  })

  it('aborts an in-flight prerequisite request and makes no later requests', async () => {
    const controller = new AbortController()
    const requests: Request[] = []
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)

      return new Promise<Response>((_resolve, reject) => {
        const rejectOnAbort = () => reject(request.signal.reason)
        if (request.signal.aborted) {
          rejectOnAbort()
          return
        }

        request.signal.addEventListener('abort', rejectOnAbort, {once: true})
      })
    })
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [teamMemberExtensions] as const})
    let settled = false
    const operationOutcome = sdk.platform.teamMember.addOrInvite('example-team', 'person@example.com', 'member', {
      signal: controller.signal,
    }).then(
      value => ({status: 'resolved' as const, value}),
      error => ({status: 'rejected' as const, error}),
    )
    const operationObserver = operationOutcome.then(() => {
      settled = true
    })

    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1))
      const request = requests[0]
      expect(request.signal.aborted).toBe(false)
      controller.abort()

      await vi.waitFor(() => expect(settled).toBe(true))
      await operationObserver
      const outcome = await operationOutcome
      expect(outcome.status).toBe('rejected')
      expect(fetch).toHaveBeenCalledOnce()
      expect(request.signal.aborted).toBe(true)
      expect(request.method).toBe('GET')
      expect(new URL(request.url).pathname).toBe('/teams/example-team')
      expect(requests).toHaveLength(1)
    } finally {
      controller.abort()
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
/* eslint-enable camelcase, perfectionist/sort-objects */
