import { DateTime } from 'luxon'
import { getNow, getToday } from '#utils/yandex_dates'
import IntegrationMetadata from '#models/integration_metadata'
import type { IYandexApiClient } from '../contracts/i_yandex_api_client.js'

const SOURCE = 'yandex'
const DEFAULT_SYNC_MONTHS_BACK = 3

// ---------------------------------------------------------------------------
// Кастомные ошибки
// ---------------------------------------------------------------------------

export class InvalidTokenError extends Error {
  constructor() {
    super('Токен не прошёл проверку — Яндекс.Директ API вернул ошибку.')
  }
}

export class InvalidDateError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export class DateAlreadySetError extends Error {
  constructor(current: string) {
    super(
      `Дата начала синхронизации уже установлена: ${current}. ` +
        `Изменить её нельзя — это инвалидирует накопленные данные. ` +
        `Для сброса выполните make migrate-fresh.`
    )
    this.name = 'DateAlreadySetError'
  }
}

// ---------------------------------------------------------------------------
// Сервис
// ---------------------------------------------------------------------------

export class YandexSettingsService {
  constructor(private readonly api: IYandexApiClient) {}

  async ensureMetadataExists(): Promise<IntegrationMetadata> {
    const meta = await IntegrationMetadata.firstOrCreate(
      { source: SOURCE },
      {
        token: null,
        lastTimestamp: null,
        syncStartDate: null,
        currentSyncDate: null,
        lastSyncAt: null,
        syncStatus: null,
      }
    )
    return meta
  }

  /**
   * Устанавливает дату начала синхронизации.
   *
   * @param useDefault - если true, устанавливает today - 3 месяца
   * @param dateIso   - конкретная дата в формате YYYY-MM-DD
   *
   * Нельзя поставить дату в будущем или раньше 3 лет (Яндекс.Директ не хранит данные старше).
   */
  async setSyncStartDate(params: { useDefault?: boolean; date?: string }): Promise<DateTime> {
    let syncStartDate: DateTime

    if (params.useDefault) {
      syncStartDate = getNow().minus({ months: DEFAULT_SYNC_MONTHS_BACK }).startOf('day')
    } else if (params.date) {
      syncStartDate = DateTime.fromISO(params.date, { zone: 'Europe/Moscow' }).startOf('day')

      if (!syncStartDate.isValid) {
        throw new InvalidDateError(
          `Некорректная дата: "${params.date}". Ожидается формат YYYY-MM-DD.`
        )
      }

      const minDate = getNow().minus({ years: 3 }).startOf('day')
      const maxDate = getToday()

      if (syncStartDate < minDate) {
        throw new InvalidDateError(
          `Дата начала синхронизации не может быть раньше ${minDate.toFormat('dd-MM-yyyy')} ` +
            `(Яндекс.Директ не хранит статистику старше 3 лет).`
        )
      }
      if (syncStartDate > maxDate) {
        throw new InvalidDateError('Дата начала синхронизации не может быть в будущем.')
      }
    } else {
      throw new InvalidDateError('Укажите значение по умолчанию или конкретную дату.')
    }

    const meta = await this.ensureMetadataExists()

    if (meta.syncStartDate !== null) {
      throw new DateAlreadySetError(meta.syncStartDate.toISODate()!)
    }

    meta.syncStartDate = syncStartDate
    await meta.save()

    return syncStartDate
  }

  async saveToken(rawToken: string): Promise<void> {
    const isValid = await this.api.ping()

    if (!isValid) {
      throw new InvalidTokenError()
    }

    const meta = await this.ensureMetadataExists()
    meta.token = rawToken
    await meta.save()
  }

  async getSettings(): Promise<{
    hasToken: boolean
    syncStartDate: DateTime | null
    syncStatus: string | null
  }> {
    const meta = await this.ensureMetadataExists()

    return {
      hasToken: meta.token !== null,
      syncStartDate: meta.syncStartDate,
      syncStatus: meta.syncStatus,
    }
  }
}
