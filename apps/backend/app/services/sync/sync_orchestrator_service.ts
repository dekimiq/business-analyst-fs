import type { ISyncService } from '@project/shared'

export class SyncOrchestratorService {
  private services: Map<string, ISyncService> = new Map()

  registerService(service: ISyncService) {
    this.services.set(service.source, service)
  }

  getService(source: string): ISyncService | undefined {
    return this.services.get(source)
  }

  getActiveServices(): ISyncService[] {
    return Array.from(this.services.values())
  }
}
