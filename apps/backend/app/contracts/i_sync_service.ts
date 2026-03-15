export interface ISyncService {
  readonly source: string
  sync(): Promise<void>
}
