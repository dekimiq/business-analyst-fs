export interface ISyncService {
  readonly source: string
  sync(force?: boolean, mode?: 'light' | 'heavy'): Promise<void>
}
