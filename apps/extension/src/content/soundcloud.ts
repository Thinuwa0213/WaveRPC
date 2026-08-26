import { ExtensionTrackPayload } from '../websocket/messages.js';
import { Logger, PrivacySanitizer } from '@waverpc/shared';

const log = new Logger('SoundCloudDetector');

declare const chrome: any;

export function parseTimeText(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;

  if (!/^\d+(:\d+)+$/.test(cleaned)) {
    return undefined;
  }

  const parts = cleaned.split(':').map((p) => parseInt(p, 10));
  if (parts.some((p) => isNaN(p) || p < 0)) {
    return undefined;
  }

  let seconds = 0;
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return undefined;
    seconds = m * 60 + s;
  } else if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return undefined;
    seconds = h * 3600 + m * 60 + s;
  } else {
    return undefined;
  }

  return seconds * 1000;
}

export class SoundCloudPageDetector {
  private lastTrackSignature: string = '';
  private lastIsPlaying: boolean | null = null;
  private hasActiveTrack: boolean = false;
  private observer: MutationObserver | null = null;
  private bodyObserver: MutationObserver | null = null;
  private disposed: boolean = false;
  private sourceSessionId: string = crypto.randomUUID();
  private cachedTrackIdentity?: string;
  private lastValidPlaybackPosition?: number;
  private lastValidDuration?: number;
  private lastValidTime?: number;

  private lastSentPlaybackPosition?: number;
  private lastSentTime?: number;
  private lastSentDuration?: number;
  private lastSentTitle?: string;
  private lastSentArtist?: string;
  private lastActualPlaybackPosition?: number;
  private lastActualDuration?: number;
  private audioListeners: Array<{
    audio: HTMLAudioElement;
    event: string;
    listener: () => void;
  }> = [];
  private messageListener:
    ((message: any, _sender: any, sendResponse: (res?: any) => void) => boolean) | null = null;

  public initialize(): void {
    log.info('Initializing detector observer...');
    this.detectAndSend('initial');
    this.setupDOMObserver();
    this.setupAudioListeners();

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      this.messageListener = (message: any, _sender: any, sendResponse: (res?: any) => void) => {
        if (message && message.type === 'REQUEST_PLAYBACK_STATE') {
          log.info('Received REQUEST_PLAYBACK_STATE from background.');
          const payload = this.buildCanonicalTrackSnapshot();

          if (payload) {
            this.lastTrackSignature = `${payload.title}|${payload.artist}|${payload.url}|${payload.isPlaying}`;
            this.lastIsPlaying = payload.isPlaying;
            this.lastSentPlaybackPosition = payload.playbackPosition;
            this.lastSentTime = Date.now();
            this.lastSentDuration = payload.duration;
            this.lastSentTitle = payload.title;
            this.lastSentArtist = payload.artist;
          }

          sendResponse({
            sourceSessionId: this.sourceSessionId,
            payload: payload,
            producer: 'request-state',
          });
        }
        return true;
      };
      chrome.runtime.onMessage.addListener(this.messageListener);
    }

    const handleUnload = () => {
      this.dispose();
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    log.info('Disposing detector...');

    this.sendToBackground({
      type: 'TRACK_CLEAR',
    });

    if (
      this.messageListener &&
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.onMessage
    ) {
      try {
        chrome.runtime.onMessage.removeListener(this.messageListener);
      } catch {
        // Ignore
      }
      this.messageListener = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
      this.bodyObserver = null;
    }

    this.audioListeners.forEach(({ audio, event, listener }) => {
      try {
        audio.removeEventListener(event, listener);
      } catch {
        // Ignore errors during tab teardown
      }
    });
    this.audioListeners = [];
  }

  private getActiveAudioElement(): HTMLAudioElement | null {
    const audios = Array.from(document.querySelectorAll('audio'));
    if (audios.length === 0) return null;

    const validAudios = audios.filter((audio) => audio.src && audio.src.trim().length > 0);
    if (validAudios.length === 0) {
      return audios[0];
    }

    // 1. Currently playing valid audio element
    const playing = validAudios.find((audio) => !audio.paused);
    if (playing) return playing;

    // 2. Paused audio element with finite duration and meaningful currentTime
    const pausedWithDurationAndTime = validAudios.find(
      (audio) =>
        audio.paused &&
        Number.isFinite(audio.duration) &&
        !isNaN(audio.duration) &&
        audio.duration > 0 &&
        !isNaN(audio.currentTime) &&
        audio.currentTime > 0
    );
    if (pausedWithDurationAndTime) return pausedWithDurationAndTime;

    const pausedWithDuration = validAudios.find(
      (audio) =>
        audio.paused &&
        Number.isFinite(audio.duration) &&
        !isNaN(audio.duration) &&
        audio.duration > 0
    );
    if (pausedWithDuration) return pausedWithDuration;

    // 3. Most recently plausible valid media element
    return validAudios[validAudios.length - 1];
  }

  private getPlaybackTiming(): {
    playbackPosition?: number;
    duration?: number;
    source: 'media-element' | 'soundcloud-dom' | 'unavailable';
  } {
    const audios = Array.from(document.querySelectorAll('audio'));
    audios.forEach((audio, idx) => {
      log.debug(`[SoundCloudDetector] Audio element #${idx}:`, {
        src: audio.src,
        paused: audio.paused,
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        ended: audio.ended,
      });
    });

    const audio = this.getActiveAudioElement();
    if (audio) {
      log.debug('[SoundCloudDetector] getActiveAudioElement selected:', {
        src: audio.src,
        paused: audio.paused,
        currentTime: audio.currentTime,
        duration: audio.duration,
      });

      const audioDuration = audio.duration;
      const audioCurrentTime = audio.currentTime;

      const hasValidDuration =
        audioDuration &&
        !isNaN(audioDuration) &&
        Number.isFinite(audioDuration) &&
        audioDuration > 0;
      const hasValidTime =
        audioCurrentTime !== undefined &&
        !isNaN(audioCurrentTime) &&
        Number.isFinite(audioCurrentTime);

      if (hasValidDuration || hasValidTime) {
        return {
          playbackPosition: hasValidTime ? Math.round(audioCurrentTime * 1000) : undefined,
          duration: hasValidDuration ? Math.round(audioDuration * 1000) : undefined,
          source: 'media-element',
        };
      }
    }

    const playControls = document.querySelector('.playControls');
    if (playControls) {
      // Layered resolution:
      // A. semantic/ARIA controls inside the player region
      // B. known stable SoundCloud player classes (including spans)
      // C. scoped text fallback inside the player controls only
      const progressWrapper =
        playControls.querySelector('.playbackTimeline__progressWrapper') ||
        playControls.querySelector('[role="progressbar"]') ||
        playControls.querySelector('.progressWrapper');

      const timePassedEl =
        playControls.querySelector('.playbackTimeline__timePassed > span[aria-hidden="true"]') ||
        playControls.querySelector('.playbackTimeline__timePassed > span') ||
        playControls.querySelector('.playbackTimeline__timePassed') ||
        playControls.querySelector('[role="progressbar"] .timePassed') ||
        playControls.querySelector('.timePassed');

      const durationEl =
        playControls.querySelector('.playbackTimeline__duration > span[aria-hidden="true"]') ||
        playControls.querySelector('.playbackTimeline__duration > span') ||
        playControls.querySelector('.playbackTimeline__duration') ||
        playControls.querySelector('[role="progressbar"] .duration') ||
        playControls.querySelector('.duration');

      let parsedDurationMs: number | undefined;
      let rawDurationText: string | undefined;
      if (durationEl) {
        rawDurationText = durationEl.textContent || undefined;
        parsedDurationMs = rawDurationText ? parseTimeText(rawDurationText) : undefined;
      }

      let parsedPositionMs: number | undefined;
      let rawCurrentText: string | undefined;
      if (timePassedEl) {
        rawCurrentText = timePassedEl.textContent || undefined;
        parsedPositionMs = rawCurrentText ? parseTimeText(rawCurrentText) : undefined;
      }

      let ariaPositionMs: number | undefined;
      let ariaDurationMs: number | undefined;

      if (progressWrapper) {
        const nowAttr =
          progressWrapper.getAttribute('aria-valuenow') ||
          progressWrapper.getAttribute('aria-value');
        const maxAttr =
          progressWrapper.getAttribute('aria-valuemax') || progressWrapper.getAttribute('aria-max');
        if (nowAttr !== null && maxAttr !== null) {
          const nowVal = parseFloat(nowAttr);
          const maxVal = parseFloat(maxAttr);
          if (!isNaN(nowVal) && !isNaN(maxVal) && maxVal > 0) {
            let candidateDurationMs: number | undefined;
            let candidatePositionMs: number | undefined;

            if (parsedDurationMs !== undefined) {
              const durationSec = Math.round(parsedDurationMs / 1000);
              // Unit check: Seconds
              if (Math.abs(maxVal - durationSec) <= 5) {
                candidateDurationMs = maxVal * 1000;
                candidatePositionMs = nowVal * 1000;
              }
              // Unit check: Milliseconds
              else if (Math.abs(maxVal - parsedDurationMs) <= 5000) {
                candidateDurationMs = maxVal;
                candidatePositionMs = nowVal;
              }
              // Unit check: Percentage
              else if (Math.abs(maxVal - 100) <= 0.1) {
                candidateDurationMs = parsedDurationMs;
                candidatePositionMs = (nowVal / 100) * parsedDurationMs;
              } else {
                log.warn(
                  '[SoundCloudDetector] ARIA valuemax is inconsistent with parsed duration. Rejecting ARIA attributes.',
                  {
                    ariaValuemax: maxVal,
                    parsedDurationMs,
                  }
                );
              }
            } else if (maxVal > 100) {
              candidateDurationMs = maxVal * 1000;
              candidatePositionMs = nowVal * 1000;
            }

            // Verify elapsed position if candidate was resolved
            if (candidatePositionMs !== undefined && parsedPositionMs !== undefined) {
              const diff = Math.abs(candidatePositionMs - parsedPositionMs);
              if (diff > 5000) {
                log.warn(
                  '[SoundCloudDetector] ARIA valuenow is inconsistent with parsed elapsed text. Rejecting ARIA attributes.',
                  {
                    ariaValuenow: nowVal,
                    candidatePositionMs,
                    parsedPositionMs,
                  }
                );
              } else {
                ariaPositionMs = candidatePositionMs;
                ariaDurationMs = candidateDurationMs;
              }
            } else {
              ariaPositionMs = candidatePositionMs;
              ariaDurationMs = candidateDurationMs;
            }
          }
        }
      }

      const playbackPosition = ariaPositionMs ?? parsedPositionMs;
      const duration = ariaDurationMs ?? parsedDurationMs;

      if (playbackPosition !== undefined || duration !== undefined) {
        log.info('[SoundCloudDetector] Playback timing resolved:', {
          source: 'soundcloud-dom',
          playbackPositionMs: playbackPosition,
          durationMs: duration,
          rawCurrentText,
          rawDurationText,
        });

        return {
          playbackPosition,
          duration,
          source: 'soundcloud-dom',
        };
      }
    }

    return {
      source: 'unavailable',
    };
  }

  private normalizeTitle(title: string): string {
    let normalized = title.trim().replace(/\s+/g, ' ');
    const prefix = 'Current track: ';
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.substring(prefix.length).trim();
    }

    // Attempt to detect accidental duplicate concatenation.
    // e.g. "CHARLIE PUTH - ATTENTION ...CHARLIE PUTH - ATTENTION ..."
    const duplicateMatch = normalized.match(/^(.*?)\s*\1$/);
    if (duplicateMatch && duplicateMatch[1] && duplicateMatch[1].trim().length > 0) {
      normalized = duplicateMatch[1].trim();
    }

    return normalized;
  }

  public buildCanonicalTrackSnapshot(): ExtensionTrackPayload | null {
    let title: string | undefined;
    let artist: string | undefined;
    let artwork: string | undefined;

    if (
      typeof navigator !== 'undefined' &&
      'mediaSession' in navigator &&
      navigator.mediaSession?.metadata
    ) {
      const meta = navigator.mediaSession.metadata;
      title = meta.title?.trim();
      artist = meta.artist?.trim();

      if (meta.artwork && meta.artwork.length > 0) {
        const lastArt = meta.artwork[meta.artwork.length - 1];
        artwork = lastArt.src;
      }
    }

    if (!title) {
      const titleElem = document.querySelector<HTMLAnchorElement>('.playbackSoundBadge__titleLink');
      title = titleElem?.innerText?.trim() || titleElem?.title?.trim();
    }

    if (!artist) {
      const artistElem = document.querySelector<HTMLAnchorElement>(
        '.playbackSoundBadge__lightLink'
      );
      artist = artistElem?.innerText?.trim() || artistElem?.title?.trim();
    }

    let url = window.location.href;
    const badgeLink = document.querySelector<HTMLAnchorElement>('.playbackSoundBadge__titleLink');
    if (badgeLink && badgeLink.href) {
      url = badgeLink.href;
    }

    if (!artwork) {
      const imgElem = document.querySelector<HTMLImageElement>(
        '.playbackSoundBadge__avatar img, .sc-artwork img'
      );
      if (imgElem && imgElem.src) {
        artwork = imgElem.src;
      } else {
        const bgElem = document.querySelector<HTMLElement>(
          '.playbackSoundBadge__avatar span.sc-artwork-img'
        );
        if (bgElem && bgElem.style.backgroundImage) {
          const match = bgElem.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1]) {
            artwork = match[1];
          }
        }
      }
    }

    let isPlaying = false;
    const playControl = document.querySelector('.playControl');
    if (playControl) {
      isPlaying =
        playControl.classList.contains('playing') ||
        playControl.classList.contains('sc-button-pause');
    }

    const audioElement = this.getActiveAudioElement();
    if (audioElement) {
      isPlaying = !audioElement.paused;
    }

    if (
      typeof navigator !== 'undefined' &&
      'mediaSession' in navigator &&
      navigator.mediaSession?.playbackState
    ) {
      if (navigator.mediaSession.playbackState === 'playing') {
        isPlaying = true;
      } else if (navigator.mediaSession.playbackState === 'paused') {
        isPlaying = false;
      }
    }

    if (!title || !artist) {
      log.debug('Metadata unavailable: missing title or artist.');
      return null;
    }

    title = this.normalizeTitle(title);
    artist = artist.trim().replace(/\s+/g, ' ');
    const trackIdentity = `${title}|${artist}`;

    if (trackIdentity !== this.cachedTrackIdentity) {
      this.cachedTrackIdentity = trackIdentity;
      this.lastValidPlaybackPosition = undefined;
      this.lastValidDuration = undefined;
      this.lastValidTime = undefined;
    }

    const timing = this.getPlaybackTiming();
    let duration = timing.duration;
    let playbackPosition = timing.playbackPosition;
    let timingSource:
      'media-element' | 'soundcloud-dom' | 'cache-derived' | 'unavailable' | undefined =
      timing.source === 'unavailable' ? undefined : timing.source;
    let timingObservedAt: number | undefined;

    const trackChanged =
      this.lastSentTitle !== undefined &&
      (title !== this.lastSentTitle || artist !== this.lastSentArtist);

    if (trackChanged && playbackPosition !== undefined) {
      let isStale = false;
      const lastPos = this.lastSentPlaybackPosition ?? this.lastActualPlaybackPosition;
      if (lastPos !== undefined && Math.abs(playbackPosition - lastPos) < 5000) {
        isStale = true;
      }
      const lastDur = this.lastSentDuration ?? this.lastActualDuration;
      if (duration !== undefined && duration === lastDur) {
        isStale = true;
      }
      if (playbackPosition > 5000) {
        isStale = true;
      }
      if (isStale) {
        playbackPosition = undefined;
        duration = undefined;
        timingSource = undefined;
      }
    }

    if (playbackPosition !== undefined) {
      this.lastValidPlaybackPosition = playbackPosition;
      this.lastValidTime = Date.now();
      timingObservedAt = this.lastValidTime;
    } else if (this.lastValidPlaybackPosition !== undefined && this.lastValidTime !== undefined) {
      // Degrade gracefully if DOM timing remains unavailable for an unreasonable duration (e.g., 60s)
      if (Date.now() - this.lastValidTime > 60000 && isPlaying) {
        playbackPosition = undefined;
      } else {
        if (isPlaying) {
          let derived = this.lastValidPlaybackPosition + (Date.now() - this.lastValidTime);
          const knownDuration = duration ?? this.lastValidDuration;
          if (knownDuration !== undefined) {
            derived = Math.min(derived, knownDuration);
          }
          playbackPosition = Math.max(0, derived);
        } else {
          playbackPosition = this.lastValidPlaybackPosition;
        }
        timingSource = 'cache-derived';
        timingObservedAt = Date.now();
      }
    }

    if (duration !== undefined) {
      this.lastValidDuration = duration;
    } else if (this.lastValidDuration !== undefined) {
      duration = this.lastValidDuration;
    }

    return {
      title,
      artist,
      url,
      artwork,
      duration,
      isPlaying,
      playbackPosition,
      providerId: 'soundcloud',
      timingObservedAt,
      timingSource,
    };
  }

  public detectAndSend(producer: string = 'observer'): void {
    if (this.disposed) return;
    const payload = this.buildCanonicalTrackSnapshot();

    if (!payload) {
      if (this.hasActiveTrack) {
        this.hasActiveTrack = false;
        this.lastTrackSignature = '';
        this.lastIsPlaying = null;
        this.lastSentPlaybackPosition = undefined;
        this.lastSentTime = undefined;
        this.lastSentDuration = undefined;
        this.lastSentTitle = undefined;
        this.lastSentArtist = undefined;
        this.lastActualPlaybackPosition = undefined;
        this.lastActualDuration = undefined;
        log.info('TRACK_CLEAR emitted: no active track detected.');
        this.sendToBackground({
          type: 'TRACK_CLEAR',
        });
      }
      return;
    }

    const rawPlaybackPosition = payload.playbackPosition;
    const rawDuration = payload.duration;

    this.hasActiveTrack = true;
    const signature = `${payload.title}|${payload.artist}|${payload.url}|${payload.isPlaying}`;

    let shouldSend = false;

    if (signature !== this.lastTrackSignature) {
      shouldSend = true;
    } else {
      // 1. Force send if playbackPosition or duration was previously undefined and now has valid value
      const durationBecameValid =
        payload.duration !== undefined && this.lastSentDuration === undefined;
      const positionBecameValid =
        payload.playbackPosition !== undefined && this.lastSentPlaybackPosition === undefined;

      if (durationBecameValid || positionBecameValid) {
        shouldSend = true;
      }

      // 2. Force send if duration changed
      if (
        payload.duration !== undefined &&
        this.lastSentDuration !== undefined &&
        payload.duration !== this.lastSentDuration
      ) {
        shouldSend = true;
      }

      // 3. Force send if seek is detected (drift > 3000ms)
      if (
        payload.playbackPosition !== undefined &&
        this.lastSentPlaybackPosition !== undefined &&
        this.lastSentTime !== undefined
      ) {
        const elapsed = this.lastIsPlaying ? Date.now() - this.lastSentTime : 0;
        const expected = this.lastSentPlaybackPosition + elapsed;
        const drift = Math.abs(payload.playbackPosition - expected);
        if (drift > 3000) {
          log.info(
            `Seek detected in content script (drift of ${drift}ms). Force sending TRACK_UPDATE.`
          );
          shouldSend = true;
        }
      }
    }

    if (!shouldSend) {
      return;
    }

    const oldSignature = this.lastTrackSignature;
    const playbackChanged = this.lastIsPlaying !== null && this.lastIsPlaying !== payload.isPlaying;

    this.lastTrackSignature = signature;
    this.lastIsPlaying = payload.isPlaying;
    this.lastSentPlaybackPosition = payload.playbackPosition;
    this.lastSentTime = Date.now();
    this.lastSentDuration = payload.duration;
    this.lastSentTitle = payload.title;
    this.lastSentArtist = payload.artist;
    this.lastActualPlaybackPosition = rawPlaybackPosition;
    this.lastActualDuration = rawDuration;

    const sanitizedUrl = PrivacySanitizer.sanitizeUrl(payload.url);

    if (!oldSignature) {
      log.info(
        `Track detected: "${payload.title}" by ${payload.artist} [${payload.isPlaying ? 'Playing' : 'Paused'}] ${sanitizedUrl}`
      );
    } else if (playbackChanged) {
      log.info(
        `Playback state changed: ${payload.isPlaying ? 'Playing' : 'Paused'} — "${payload.title}" by ${payload.artist}`
      );
    } else {
      log.info(
        `Track changed: "${payload.title}" by ${payload.artist} [${payload.isPlaying ? 'Playing' : 'Paused'}] ${sanitizedUrl}`
      );
    }

    const audioElement = this.getActiveAudioElement();
    log.info('[DEV-LOG] ContentScript TRACK_UPDATE outgoing payload:', {
      currentTimeSeconds: audioElement ? audioElement.currentTime : undefined,
      durationSeconds: audioElement ? audioElement.duration : undefined,
      playbackPositionMs: payload.playbackPosition,
      durationMs: payload.duration,
      isPlaying: payload.isPlaying,
      title: payload.title,
    });

    this.sendToBackground({
      type: 'TRACK_UPDATE',
      payload,
      producer,
    });
  }

  private setupDOMObserver(): void {
    const targetNode = document.querySelector('.playControls') || document.body;
    this.observer = new MutationObserver(() => {
      if (this.disposed) return;
      this.detectAndSend('observer');
    });

    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'title', 'src', 'href'],
    });
  }

  private setupAudioListeners(): void {
    const attachToAudio = (audio: HTMLAudioElement) => {
      const events = ['play', 'pause', 'playing', 'ended'];
      events.forEach((evtName) => {
        const listener = () => {
          if (this.disposed) return;
          this.detectAndSend('media-event');
        };
        audio.addEventListener(evtName, listener);
        this.audioListeners.push({ audio, event: evtName, listener });
      });
    };

    const existingAudio = document.querySelector<HTMLAudioElement>('audio');
    if (existingAudio) {
      attachToAudio(existingAudio);
    }

    this.bodyObserver = new MutationObserver((mutations) => {
      if (this.disposed) return;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'AUDIO') {
            attachToAudio(node as HTMLAudioElement);
          }
        });
      });
    });

    this.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  private sendToBackground(message: any): void {
    if (this.disposed) return;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const msgWithSession = {
        ...message,
        sourceSessionId: this.sourceSessionId,
      };
      chrome.runtime.sendMessage(msgWithSession, (_response: unknown) => {
        if (chrome.runtime.lastError) {
          // Ignored if background script is sleeping
        }
      });
    }
  }
}

if (typeof document !== 'undefined') {
  const detector = new SoundCloudPageDetector();
  detector.initialize();
}
