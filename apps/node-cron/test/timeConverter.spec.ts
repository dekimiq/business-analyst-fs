import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We must mock @project/env completely because env.TZ is evaluated at import time
vi.mock('@project/env', () => {
  return {
    env: {
      get TZ() {
        return process.env.TEST_TZ || 'UTC'
      },
    },
  }
})

import { convertLocalTimeToUTC } from '../src/timeConverter.js'

describe('convertLocalTimeToUTC', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    delete process.env.TEST_TZ
    vi.useRealTimers()
  })

  it('should convert time backward smoothly if timezone is ahead of UTC', () => {
    process.env.TEST_TZ = 'Europe/Moscow'
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const result = convertLocalTimeToUTC(3, 0)
    expect(result).toEqual({ utcHour: 0, utcMinute: 0 })
  })

  it('should roll over to the previous UTC day effectively (returning correct 24h clock)', () => {
    process.env.TEST_TZ = 'Europe/Moscow'
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const result = convertLocalTimeToUTC(1, 0)
    expect(result).toEqual({ utcHour: 22, utcMinute: 0 })
  })

  it('should handle fallback to UTC when TZ is missing', () => {
    process.env.TEST_TZ = ''
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const result = convertLocalTimeToUTC(9, 15)
    expect(result).toEqual({ utcHour: 9, utcMinute: 15 })
  })
})
