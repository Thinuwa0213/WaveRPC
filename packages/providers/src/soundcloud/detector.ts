import { SoundCloudMetadata } from './types.js';

export class SoundCloudDetector {
  /**
   * Stub method for checking if current page/window is SoundCloud.
   * Full DOM/MediaSession detection will be implemented in Phase 1.
   */
  public isSoundCloudPage(url?: string): boolean {
    if (!url) return false;
    return url.includes('soundcloud.com');
  }

  /**
   * Stub method for detecting track metadata from SoundCloud session.
   * Detection logic to be implemented in Phase 1.
   */
  public detectTrack(): SoundCloudMetadata | undefined {
    return undefined;
  }
}
