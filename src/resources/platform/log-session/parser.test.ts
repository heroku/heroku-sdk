import {describe, expect, it} from 'vitest'

import {parseHerokuLogLine} from './parser.js'

describe('parseHerokuLogLine', () => {
  it('parses state-changed lines', () => {
    expect(parseHerokuLogLine('2024-11-08T20:46:09Z heroku[web.1]: State changed from up to down'))
      .toEqual({
        dynoName: 'web.1', from: 'up', kind: 'state-changed', source: 'heroku', to: 'down',
      })
  })

  it('parses state-changed lines with Fir hyphenated dyno names', () => {
    // Fir-generation apps use names like `web-abc-123` instead of `web.1`.
    expect(parseHerokuLogLine('2024-11-08T20:46:09Z heroku[web-abc-123]: State changed from starting to up'))
      .toEqual({
        dynoName: 'web-abc-123', from: 'starting', kind: 'state-changed', source: 'heroku', to: 'up',
      })
  })

  it('parses state-changed lines without a timestamp prefix', () => {
    // The platform sometimes omits the timestamp (replays, custom drains).
    expect(parseHerokuLogLine('heroku[web.1]: State changed from up to down'))
      .toEqual({
        dynoName: 'web.1', from: 'up', kind: 'state-changed', source: 'heroku', to: 'down',
      })
  })

  it('parses scaled-to lines with a single dyno type', () => {
    expect(parseHerokuLogLine('app[api]: Scaled to web@2:Standard-1X by user@example.com'))
      .toEqual({
        entries: [{dynoType: 'web', quantity: 2, size: 'Standard-1X'}],
        kind: 'scaled-to',
      })
  })

  it('parses scaled-to lines with multiple dyno types in one shot', () => {
    // Real platform emits all process-type changes from a single
    // `ps:scale` invocation as one line. Used to be silently truncated
    // to the first entry.
    expect(parseHerokuLogLine('app[api]: Scaled to web@2:Standard-1X worker@1:Standard-2X release@0:Standard-1X by user@example.com'))
      .toEqual({
        entries: [
          {dynoType: 'web', quantity: 2, size: 'Standard-1X'},
          {dynoType: 'worker', quantity: 1, size: 'Standard-2X'},
          {dynoType: 'release', quantity: 0, size: 'Standard-1X'},
        ],
        kind: 'scaled-to',
      })
  })

  it('parses attachment-attached lines', () => {
    expect(parseHerokuLogLine('app[api]: Attach LOGDNA (@ref:logdna-deep-31633)'))
      .toEqual({configVar: 'LOGDNA', kind: 'attachment-attached', ref: 'logdna-deep-31633'})
  })

  it('parses attachment-detached lines', () => {
    expect(parseHerokuLogLine('app[api]: Detach LOGDNA (@ref:logdna-deep-31633)'))
      .toEqual({configVar: 'LOGDNA', kind: 'attachment-detached', ref: 'logdna-deep-31633'})
  })

  it('parses attachment-updated lines', () => {
    expect(parseHerokuLogLine('app[heroku-postgres]: Update DATABASE by user@example.com'))
      .toEqual({configVar: 'DATABASE', kind: 'attachment-updated', service: 'heroku-postgres'})
  })

  it('parses attachment-updated lines whose configVar contains digits', () => {
    // E.g. promoting DATABASE2 to follow primary.
    expect(parseHerokuLogLine('app[heroku-postgres]: Update DATABASE2_URL by user@example.com'))
      .toEqual({configVar: 'DATABASE2_URL', kind: 'attachment-updated', service: 'heroku-postgres'})
  })

  it('parses provisioning-completed lines', () => {
    expect(parseHerokuLogLine('app[api]: @ref:searchbox-tapered-14398 completed provisioning'))
      .toEqual({kind: 'provisioning-completed', ref: 'searchbox-tapered-14398'})
  })

  it('parses starting-process lines and strips backticks from the command', () => {
    expect(parseHerokuLogLine('heroku[web.1]: Starting process with command `npm start`'))
      .toEqual({
        command: 'npm start', dynoName: 'web.1', kind: 'starting-process', source: 'heroku',
      })
  })

  it('returns undefined for application output', () => {
    expect(parseHerokuLogLine('app[web.1]: Listening on port 5000')).toBeUndefined()
  })

  it('returns undefined for an empty line', () => {
    expect(parseHerokuLogLine('')).toBeUndefined()
  })

  it('returns undefined for an unrelated heroku line', () => {
    expect(parseHerokuLogLine('heroku[router]: at=info method=GET path="/" host=example.com')).toBeUndefined()
  })

  it('tolerates trailing content on a recognized line', () => {
    expect(parseHerokuLogLine('heroku[web.1]: State changed from up to down — extra trailing text')?.kind)
      .toBe('state-changed')
  })
})
