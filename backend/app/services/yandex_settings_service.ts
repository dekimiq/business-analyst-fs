import { DateTime } from 'luxon'
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

// ---------------------------------------------------------------------------
// Сервис
// ---------------------------------------------------------------------------

export class YandexSettingsService {
  constructor(private readonly api: IYandexApiClient) {}

  /**
   * Гарантирует существование записи integration_metadata для Яндекса.
   * Если её нет — создаёт с нулевыми полями.
   * Вызывается один раз при старте или перед первым обращением.
   */
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
   * Нельзя поставить дату в будущем или раньше 2015-01-01 (Яндекс.Директ не хранит данные старше).
   */
  async setSyncStartDate(params: { useDefault?: boolean; date?: string }): Promise<DateTime> {
    let syncStartDate: DateTime

    if (params.useDefault) {
      syncStartDate = DateTime.now().minus({ months: DEFAULT_SYNC_MONTHS_BACK }).startOf('day')
    } else if (params.date) {
      syncStartDate = DateTime.fromISO(params.date, { zone: 'utc' })

      if (!syncStartDate.isValid) {
        throw new InvalidDateError(
          `Некорректная дата: "${params.date}". Ожидается формат YYYY-MM-DD.`
        )
      }

      const minDate = DateTime.now().minus({ years: 3 }).startOf('day')
      const maxDate = DateTime.now().startOf('day')

      if (syncStartDate < minDate) {
        throw new InvalidDateError(
          `Дата начала синхронизации не может быть раньше ${minDate.toFormat('dd-MM-yyyy')}.`
        )
      }
      if (syncStartDate > maxDate) {
        throw new InvalidDateError('Дата начала синхронизации не может быть в будущем.')
      }
    } else {
      throw new InvalidDateError('Укажите значение по умолчанию или конкретную дату.')
    }

    const meta = await this.ensureMetadataExists()

    if (meta.syncStatus === 'success') {
      meta.syncStatus = null
      meta.currentSyncDate = null
    }

    meta.syncStartDate = syncStartDate
    await meta.save()

    return syncStartDate
  }

  /**
   * Сохраняет токен Яндекс.Директ.
   *
   * Flow:
   *  1. Пинг к API с переданным токеном → проверяем что токен рабочий
   *  2. Шифруем через AdonisJS encryption (AES-256)
   *  3. Сохраняем в integration_metadata
   */
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
