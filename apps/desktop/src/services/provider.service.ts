import { ProviderRegistry, SoundCloudProvider, MockProvider } from '@waverpc/providers';
import { TypedEventEmitter, Track, PlaybackState } from '@waverpc/shared';

export class ProviderService {
  private registry: ProviderRegistry;

  constructor(private events: TypedEventEmitter) {
    this.registry = new ProviderRegistry();
    this.registerDefaultProviders();
  }

  private registerDefaultProviders(): void {
    const soundcloud = new SoundCloudProvider();
    const mock = new MockProvider();
    this.registry.register(soundcloud);
    this.registry.register(mock);
  }

  public getRegistry(): ProviderRegistry {
    return this.registry;
  }

  public async detectActiveProvider(url?: string): Promise<string | undefined> {
    const provider = await this.registry.findSupportedProvider(url);
    if (provider) {
      this.registry.setActiveProvider(provider.metadata.id);
      this.events.emit('provider:activated', provider.metadata.id);
      return provider.metadata.id;
    }
    return undefined;
  }

  public setTrack(track: Track | undefined): void {
    this.events.emit('track:changed', track);
  }

  public setPlaybackState(state: PlaybackState): void {
    this.events.emit('playback:stateChanged', state);
  }
}
