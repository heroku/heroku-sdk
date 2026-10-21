/* eslint-disable camelcase -- platform delinquency wire format */
import {describe, expect, it} from 'vitest'

import {formatDelinquencyWarning} from './delinquency.js'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')
const FUTURE = '2026-02-01T00:00:00.000Z'
const PAST = '2025-12-01T00:00:00.000Z'
const LATER_FUTURE = '2026-03-01T00:00:00.000Z'

describe('formatDelinquencyWarning', () => {
  it('returns undefined when the delinquency is null or undefined', () => {
    expect(formatDelinquencyWarning('account', null, NOW)).toBeUndefined()
    expect(formatDelinquencyWarning('account', undefined, NOW)).toBeUndefined()
  })

  it('returns undefined when neither timestamp is set', () => {
    expect(formatDelinquencyWarning('account', {
      scheduled_deletion_time: null,
      scheduled_suspension_time: null,
    }, NOW)).toBeUndefined()
  })

  it('warns about an upcoming suspension when the suspension is in the future', () => {
    const message = formatDelinquencyWarning('account', {
      scheduled_deletion_time: null,
      scheduled_suspension_time: FUTURE,
    }, NOW)

    expect(message).toBe(`This account is delinquent with payment and we'll suspend it on ${new Date(Date.parse(FUTURE)).toString()}.`)
  })

  it('warns about a past suspension and upcoming deletion when the suspension is in the past', () => {
    const message = formatDelinquencyWarning('team', {
      scheduled_deletion_time: LATER_FUTURE,
      scheduled_suspension_time: PAST,
    }, NOW)

    expect(message).toBe(`This team is delinquent with payment and we suspended it on ${new Date(Date.parse(PAST)).toString()}. `
      + `If the team is still delinquent, we'll delete it on ${new Date(Date.parse(LATER_FUTURE)).toString()}.`)
  })

  it('returns undefined for a past suspension with no deletion scheduled', () => {
    expect(formatDelinquencyWarning('account', {
      scheduled_deletion_time: null,
      scheduled_suspension_time: PAST,
    }, NOW)).toBeUndefined()
  })

  it('warns about an upcoming deletion when only a deletion is scheduled', () => {
    const message = formatDelinquencyWarning('account', {
      scheduled_deletion_time: FUTURE,
      scheduled_suspension_time: null,
    }, NOW)

    expect(message).toBe(`This account is delinquent with payment and we'll delete it on ${new Date(Date.parse(FUTURE)).toString()}.`)
  })

  it('uses the resource word in the message', () => {
    const message = formatDelinquencyWarning('team', {
      scheduled_deletion_time: null,
      scheduled_suspension_time: FUTURE,
    }, NOW)

    expect(message).toContain('This team is delinquent')
  })

  it('treats unparseable timestamps as absent', () => {
    expect(formatDelinquencyWarning('account', {
      scheduled_deletion_time: 'not-a-date',
      scheduled_suspension_time: 'also-not-a-date',
    }, NOW)).toBeUndefined()
  })

  it('defaults now to the wall clock', () => {
    // A suspension one hour out is in the future relative to the real clock.
    const soon = new Date(Date.now() + (60 * 60 * 1000)).toISOString()
    const message = formatDelinquencyWarning('account', {
      scheduled_deletion_time: null,
      scheduled_suspension_time: soon,
    })

    expect(message).toContain("we'll suspend it on")
  })
})
