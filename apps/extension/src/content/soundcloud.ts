import { SoundCloudProvider } from '@waverpc/providers';

declare const chrome: any;

const provider = new SoundCloudProvider();
console.log(`[WaveRPC Content Script] Loaded provider: ${provider.metadata.name}`);

export function reportTrackUpdate(): void {
  const track = provider.getCurrentTrack();
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      type: 'TRACK_UPDATE',
      payload: track,
    });
  }
}
