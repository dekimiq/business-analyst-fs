import { describe, it, expect } from 'vitest'
import { parseTime } from '../src/db.js'

describe('parseTime', () => {
  it('должен корректно разбирать валидную строку времени в час и минуту', () => {
    expect(parseTime('03:00')).toEqual({ hour: 3, minute: 0 })
    expect(parseTime('09:45')).toEqual({ hour: 9, minute: 45 })
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 })
  })

  it('должен возвращать undefined для некорректных строк', () => {
    // Отсутствует двоеточие
    expect(parseTime('1200')).toBeUndefined()
    expect(parseTime('abc')).toBeUndefined()

    // Слишком много частей
    expect(parseTime('12:00:00')).toBeUndefined()

    // Часы или минуты вне диапазона
    expect(parseTime('25:00')).toBeUndefined()
    expect(parseTime('03:60')).toBeUndefined()

    // Отрицательные значения
    expect(parseTime('-1:00')).toBeUndefined()
    expect(parseTime('03:-5')).toBeUndefined()

    // Словосочетания и буквы
    expect(parseTime('ab:cd')).toBeUndefined()
  })
})
