import { describe, it, expect } from 'vitest'
import { parseTime } from '../src/db.js'

describe('parseTime', () => {
  it('should explicitly parse a valid time string into hour and minute', () => {
    expect(parseTime('03:00')).toEqual({ hour: 3, minute: 0 })
    expect(parseTime('09:45')).toEqual({ hour: 9, minute: 45 })
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 })
  })

  it('should return undefined for malformed strings', () => {
    // Missing colon
    expect(parseTime('1200')).toBeUndefined()
    expect(parseTime('abc')).toBeUndefined()

    // Too many parts
    expect(parseTime('12:00:00')).toBeUndefined()

    // Out of bounds minutes or hours
    expect(parseTime('25:00')).toBeUndefined()
    expect(parseTime('03:60')).toBeUndefined()

    // Negative values
    expect(parseTime('-1:00')).toBeUndefined()
    expect(parseTime('03:-5')).toBeUndefined()

    // Random words and letters mixing
    expect(parseTime('ab:cd')).toBeUndefined()
  })
})
