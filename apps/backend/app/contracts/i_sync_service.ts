export interface ISyncService {
  readonly source: string
  sync(force?: boolean): Promise<void>
}
