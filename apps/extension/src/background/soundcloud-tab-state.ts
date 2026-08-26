import { ExtensionTrackPayload } from '../websocket/messages.js';

export class SoundCloudTabStateManager {
  private soundCloudTabs = new Map<
    number,
    { sourceSessionId: string; payload: ExtensionTrackPayload }
  >();
  private activePlaybackTabId: number | null = null;
  private invalidatedSessionIds = new Set<string>();
  private desktopHasTrack: boolean = false;

  constructor(
    private callbacks: {
      onTrackUpdate: (payload: ExtensionTrackPayload) => void;
      onTrackClear: () => void;
    }
  ) {}

  public getActivePlaybackTabId(): number | null {
    return this.activePlaybackTabId;
  }

  public getTabs(): Map<number, ExtensionTrackPayload> {
    const tabs = new Map<number, ExtensionTrackPayload>();
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
    tabId: number,
    sourceSessionId: string,
    payload: ExtensionTrackPayload,
    tabUrl?: string
  ): void {
    if (typeof tabId !== 'number') return;
    if (tabUrl && !tabUrl.includes('soundcloud.com')) return;
    if (this.invalidatedSessionIds.has(sourceSessionId)) return;

    const existing = this.soundCloudTabs.get(tabId);
    if (existing && existing.sourceSessionId !== sourceSessionId) {
      this.invalidateSession(existing.sourceSessionId);
    }

    this.soundCloudTabs.set(tabId, { sourceSessionId, payload });

    if (payload.isPlaying) {
      this.activePlaybackTabId = tabId;
    } else if (this.activePlaybackTabId === null || this.activePlaybackTabId === tabId) {
      this.activePlaybackTabId = tabId;
    } else {
      const activeTab = this.soundCloudTabs.get(this.activePlaybackTabId);
      if (!activeTab || !activeTab.payload.isPlaying) {
        this.activePlaybackTabId = tabId;
      }
    }

    if (this.activePlaybackTabId === tabId) {
      this.forwardTrackUpdate(payload);
    }
  }

  /**
   * Called when a tab sends a TRACK_CLEAR.
   */
  public handleTrackClear(tabId: number, sourceSessionId: string): void {
    if (this.invalidatedSessionIds.has(sourceSessionId)) {
      return;
    }

    const existing = this.soundCloudTabs.get(tabId);
    if (!existing || existing.sourceSessionId !== sourceSessionId) {
      return;
    }

    this.invalidateSession(sourceSessionId);
    this.soundCloudTabs.delete(tabId);

    if (this.activePlaybackTabId === tabId) {
      this.resolveActivePlaybackReplacement();
    }
  }

  /**
   * Called when a tab is removed, loading, or navigated away.
   */
  public handleTabRemoved(tabId: number): void {
    const existing = this.soundCloudTabs.get(tabId);
    if (existing) {
      this.invalidateSession(existing.sourceSessionId);
      this.soundCloudTabs.delete(tabId);
    }

    if (this.activePlaybackTabId === tabId) {
      this.resolveActivePlaybackReplacement();
    }
  }

  private resolveActivePlaybackReplacement(): void {
    let replacementTabId: number | null = null;
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
