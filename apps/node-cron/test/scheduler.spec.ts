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

describe('Модуль Планировщика (Scheduler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('должен обработать корректное расписание из БД и вызвать node-cron', async () => {
    // Мок ответа Knex
    const mockDbSelect = vi
      .fn()
      .mockResolvedValue([{ name: 'sync', time_hh_mm: '03:00', day_of_week: null }])
    // Мок цепочки вызовов `db('schedules').select('*')`
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    await reloadSchedules()

    // Должен был быть сделан запрос к БД
    expect(mockDbSelect).toHaveBeenCalled()

    // Должен был быть вызван парсинг времени
    expect(convertLocalTimeToUTC).toHaveBeenCalledWith(3, 0)

    // Должна была быть создана cron-последовательность (3:00 UTC)
    // формат: `${utcMinute} ${utcHour} * * *`
    expect(cron.schedule).toHaveBeenCalledWith(
      '0 3 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'UTC' }),
    )

    // Не должен был отправлять уведомление об ошибке
    expect(BotNotifier.notifyAlert).not.toHaveBeenCalled()
  })

  it('должен игнорировать некорректные строки времени и выводить ошибку в консоль', async () => {
    const mockDbSelect = vi
      .fn()
      .mockResolvedValue([{ name: 'broken', time_hh_mm: 'invalid', day_of_week: null }])
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    // Следим за console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await reloadSchedules()

    expect(cron.schedule).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Неверный формат времени'))
    consoleSpy.mockRestore()
  })

  it('должен перехватывать ошибки подключения к БД и уведомлять BotNotifier', async () => {
    const errorObj = new Error('Database Down')
    const mockDbSelect = vi.fn().mockRejectedValue(errorObj)
    const dbMock = db as unknown as ReturnType<typeof vi.fn>
    dbMock.mockReturnValue({ select: mockDbSelect })

    await reloadSchedules()

    expect(BotNotifier.notifyAlert).toHaveBeenCalledWith(
      'Ошибка получения расписаний из БД',
      errorObj,
    )
    expect(cron.schedule).not.toHaveBeenCalled()
  })
})
