import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import cron from 'node-cron'
import { reloadSchedules } from '../src/scheduler.js'
import { db } from '../src/db.js'
import { BotNotifier } from '../src/services/botNotifier.js'
import { convertLocalTimeToUTC } from '../src/timeConverter.js'

// Mock dependencies
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}))

vi.mock('../src/db.js', () => ({
  db: vi.fn(),
  parseTime: vi.fn((time) => {
    if (time === 'invalid') return undefined
    const [h, m] = time.split(':')
    return { hour: parseInt(h, 10), minute: parseInt(m, 10) }
  }),
}))

vi.mock('../src/timeConverter.js', () => ({
  convertLocalTimeToUTC: vi.fn((h, m) => ({ utcHour: h, utcMinute: m })),
}))

vi.mock('../src/services/botNotifier.js', () => ({
  BotNotifier: {
    notifyAlert: vi.fn(),
  },
}))

describe('Scheduler Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should process a valid schedule from DB and invoke node-cron', async () => {
    // Mock Knex response
    const mockDbSelect = vi
      .fn()
      .mockResolvedValue([{ name: 'sync', time_hh_mm: '03:00', day_of_week: null }])
    // The query builder chain mock `db('schedules').select('*')`
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    await reloadSchedules()

    // It should have queried the DB
    expect(mockDbSelect).toHaveBeenCalled()

    // It should have parsed the time
    expect(convertLocalTimeToUTC).toHaveBeenCalledWith(3, 0)

    // It should have created the cron sequence (3:00 UTC)
    // format is `${utcMinute} ${utcHour} * * *`
    expect(cron.schedule).toHaveBeenCalledWith(
      '0 3 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'UTC' }),
    )

    // It should NOT have sent an error
    expect(BotNotifier.notifyAlert).not.toHaveBeenCalled()
  })

  it('should ignore and skip malformed strings, calling bot notifier logic later if implemented, but bypasses correctly here', async () => {
    const mockDbSelect = vi
      .fn()
      .mockResolvedValue([{ name: 'broken', time_hh_mm: 'invalid', day_of_week: null }])
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    // Spy on console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await reloadSchedules()

    expect(cron.schedule).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid time format'))
    consoleSpy.mockRestore()
  })

  it('should capture DB connection errors and notify the BotNotifier completely', async () => {
    const errorObj = new Error('Database Down')
    const mockDbSelect = vi.fn().mockRejectedValue(errorObj)
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    await reloadSchedules()

    expect(BotNotifier.notifyAlert).toHaveBeenCalledWith('Reload Schedules DB fetch', errorObj)
    expect(cron.schedule).not.toHaveBeenCalled()
  })
})
