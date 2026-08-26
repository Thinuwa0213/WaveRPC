import { ExtensionTrackPayload } from '../websocket/messages.js';
import { Logger, PrivacySanitizer } from '@waverpc/shared';

const log = new Logger('SoundCloudDetector');

declare const chrome: any;

export class SoundCloudPageDetector {
  private lastTrackSignature: string = '';
  private lastIsPlaying: boolean | null = null;
  private hasActiveTrack: boolean = false;
  private observer: MutationObserver | null = null;
  private bodyObserver: MutationObserver | null = null;
  private disposed: boolean = false;
  private sourceSessionId: string = crypto.randomUUID();
  private audioListeners: Array<{
    audio: HTMLAudioElement;
    event: string;
    listener: () => void;
  }> = [];

  public initialize(): void {
    log.info('Initializing detector observer...');
    this.detectAndSend();
    this.setupDOMObserver();
    this.setupAudioListeners();

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

  public detectTrackPayload(): ExtensionTrackPayload | null {
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

    const audioElement = document.querySelector<HTMLAudioElement>('audio');
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

    let duration: number | undefined;
    if (audioElement && !isNaN(audioElement.duration) && audioElement.duration > 0) {
      duration = Math.round(audioElement.duration * 1000);
    }

    let playbackPosition: number | undefined;
    if (audioElement && !isNaN(audioElement.currentTime)) {
      playbackPosition = Math.round(audioElement.currentTime * 1000);
    }

    if (!title || !artist) {
      log.debug('Metadata unavailable: missing title or artist.');
      return null;
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
    };
  }

  public detectAndSend(): void {
    if (this.disposed) return;
    const payload = this.detectTrackPayload();

    if (!payload) {
      if (this.hasActiveTrack) {
        this.hasActiveTrack = false;
        this.lastTrackSignature = '';
        this.lastIsPlaying = null;
        log.info('TRACK_CLEAR emitted: no active track detected.');
        this.sendToBackground({
          type: 'TRACK_CLEAR',
        });
      }
      return;
    }

    this.hasActiveTrack = true;
    const signature = `${payload.title}|${payload.artist}|${payload.url}|${payload.isPlaying}`;
    if (signature === this.lastTrackSignature) {
      return;
    }

    const oldSignature = this.lastTrackSignature;
    const playbackChanged = this.lastIsPlaying !== null && this.lastIsPlaying !== payload.isPlaying;
    this.lastTrackSignature = signature;
    this.lastIsPlaying = payload.isPlaying;

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

    this.sendToBackground({
      type: 'TRACK_UPDATE',
      payload,
    });
  }

  private setupDOMObserver(): void {
    const targetNode = document.querySelector('.playControls') || document.body;
    this.observer = new MutationObserver(() => {
      if (this.disposed) return;
      this.detectAndSend();
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
          this.detectAndSend();
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
