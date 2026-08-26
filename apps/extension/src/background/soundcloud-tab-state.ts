import { ExtensionTrackPayload } from '../websocket/messages.js';

export type PlaybackSourceId = number | string;

export class SoundCloudTabStateManager {
  private soundCloudTabs = new Map<
    PlaybackSourceId,
    { sourceSessionId: string; payload: ExtensionTrackPayload }
  >();
  private activePlaybackTabId: PlaybackSourceId | null = null;
  private invalidatedSessionIds = new Set<string>();
  private desktopHasTrack: boolean = false;

  constructor(
    private callbacks: {
      onTrackUpdate: (payload: ExtensionTrackPayload) => void;
      onTrackClear: () => void;
    }
  ) {}

  public getActivePlaybackTabId(): PlaybackSourceId | null {
    return this.activePlaybackTabId;
  }

  public getTabs(): Map<PlaybackSourceId, ExtensionTrackPayload> {
    const tabs = new Map<PlaybackSourceId, ExtensionTrackPayload>();
    for (const [id, state] of this.soundCloudTabs.entries()) {
      tabs.set(id, state.payload);
    }
    return tabs;
  }

  private forwardTrackUpdate(payload: ExtensionTrackPayload): void {
    this.desktopHasTrack = true;
    this.callbacks.onTrackUpdate(payload);
  }

  private forwardTrackClear(): void {
    if (this.desktopHasTrack) {
      this.desktopHasTrack = false;
      this.callbacks.onTrackClear();
    }
  }

  /**
   * Called when a tab sends a TRACK_UPDATE.
   */
  public handleTrackUpdate(
    sourceId: PlaybackSourceId,
    sourceSessionId: string,
    payload: ExtensionTrackPayload,
    tabUrl?: string
  ): void {
    if (sourceId === undefined || sourceId === null) return;
    if (tabUrl && !tabUrl.includes('soundcloud.com')) return;
    if (payload.url && !payload.url.includes('soundcloud.com')) return;
    if (this.invalidatedSessionIds.has(sourceSessionId)) return;

    const existing = this.soundCloudTabs.get(sourceId);
    if (existing && existing.sourceSessionId !== sourceSessionId) {
      this.invalidateSession(existing.sourceSessionId);
    }

    this.soundCloudTabs.set(sourceId, { sourceSessionId, payload });

    if (payload.isPlaying) {
      this.activePlaybackTabId = sourceId;
    } else if (this.activePlaybackTabId === null || this.activePlaybackTabId === sourceId) {
      this.activePlaybackTabId = sourceId;
    } else {
      const activeTab = this.soundCloudTabs.get(this.activePlaybackTabId);
      if (!activeTab || !activeTab.payload.isPlaying) {
        this.activePlaybackTabId = sourceId;
      }
    }

    if (this.activePlaybackTabId === sourceId) {
      this.forwardTrackUpdate(payload);
    }
  }

  /**
   * Called when a tab sends a TRACK_CLEAR.
   */
  public handleTrackClear(sourceId: PlaybackSourceId, sourceSessionId: string): void {
    if (this.invalidatedSessionIds.has(sourceSessionId)) {
      return;
    }

    const existing = this.soundCloudTabs.get(sourceId);
    if (!existing || existing.sourceSessionId !== sourceSessionId) {
      return;
    }

    this.invalidateSession(sourceSessionId);
    this.soundCloudTabs.delete(sourceId);

    if (this.activePlaybackTabId === sourceId) {
      this.resolveActivePlaybackReplacement();
    }
  }

  /**
   * Called when a tab is removed, loading, or navigated away.
   */
  public handleTabRemoved(sourceId: PlaybackSourceId): void {
    const existing = this.soundCloudTabs.get(sourceId);
    if (existing) {
      this.invalidateSession(existing.sourceSessionId);
      this.soundCloudTabs.delete(sourceId);
    }

    if (this.activePlaybackTabId === sourceId) {
      this.resolveActivePlaybackReplacement();
    }
  }

  private resolveActivePlaybackReplacement(): void {
    let replacementTabId: PlaybackSourceId | null = null;
    let replacementPayload: ExtensionTrackPayload | null = null;

    // 1. Try to find a playing tab
    for (const [id, state] of this.soundCloudTabs.entries()) {
      if (state.payload.isPlaying) {
        replacementTabId = id;
        replacementPayload = state.payload;
        break;
      }
    }

    // 2. Try to find any paused tab
    if (!replacementTabId) {
      for (const [id, state] of this.soundCloudTabs.entries()) {
        replacementTabId = id;
        replacementPayload = state.payload;
        break;
      }
    }

    if (replacementTabId && replacementPayload) {
      this.activePlaybackTabId = replacementTabId;
      this.forwardTrackUpdate(replacementPayload);
    } else {
      this.activePlaybackTabId = null;
      this.forwardTrackClear();
    }
  }

  private invalidateSession(sessionId: string): void {
    if (!sessionId) return;
    this.invalidatedSessionIds.add(sessionId);

    // Bounded tombstones (max 256)
    if (this.invalidatedSessionIds.size > 256) {
      const oldestKey = this.invalidatedSessionIds.values().next().value;
      if (oldestKey !== undefined) {
        this.invalidatedSessionIds.delete(oldestKey);
      }
    }
  }
}
