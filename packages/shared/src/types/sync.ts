export interface ISyncService {
  readonly source: string
  sync(): Promise<void>
  isReady(): Promise<boolean>
  getDataAvailability(): Promise<{ availableUntil: string | null }>
}
