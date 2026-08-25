import { BaseProvider } from './base.js';
import { PlaybackState, Track } from '@waverpc/shared';

export class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();
  private activeProviderId: string | null = null;

  public register(provider: BaseProvider): void {
    this.providers.set(provider.metadata.id, provider);
  }

  public unregister(providerId: string): boolean {
    if (this.activeProviderId === providerId) {
      this.activeProviderId = null;
    }
    return this.providers.delete(providerId);
  }

  public getProvider(providerId: string): BaseProvider | undefined {
    return this.providers.get(providerId);
  }

  public getAllProviders(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  public async findSupportedProvider(context?: unknown): Promise<BaseProvider | undefined> {
    for (const provider of this.providers.values()) {
      if (await provider.isSupported(context)) {
        return provider;
      }
    }
    return undefined;
  }

  public setActiveProvider(providerId: string | null): void {
    if (providerId && !this.providers.has(providerId)) {
      throw new Error(`Provider with id '${providerId}' is not registered.`);
    }
    this.activeProviderId = providerId;
  }

  public getActiveProvider(): BaseProvider | undefined {
    if (!this.activeProviderId) return undefined;
    return this.providers.get(this.activeProviderId);
  }

  public async getActiveTrack(): Promise<Track | undefined> {
    const active = this.getActiveProvider();
    if (!active) return undefined;
    return active.getCurrentTrack();
  }

  public async getActivePlaybackState(): Promise<PlaybackState> {
    const active = this.getActiveProvider();
    if (!active) return 'unknown';
    return active.getPlaybackState();
  }
}
