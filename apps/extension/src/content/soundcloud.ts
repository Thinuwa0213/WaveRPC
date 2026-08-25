import { ExtensionTrackPayload } from '../websocket/messages.js';

declare const chrome: any;

export class SoundCloudPageDetector {
  private lastTrackSignature: string = '';
  private observer: MutationObserver | null = null;

  public initialize(): void {
    console.log('[WaveRPC SoundCloud Detector] Initializing detector observer...');
    this.detectAndSend();
    this.setupDOMObserver();
    this.setupAudioListeners();
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

    if (!title || !artist) {
      return null;
    }

    return {
      title,
      artist,
      url,
      artwork,
      duration,
      isPlaying,
      providerId: 'soundcloud',
    };
  }

  public detectAndSend(): void {
    const payload = this.detectTrackPayload();
    if (!payload) return;

    const signature = `${payload.title}|${payload.artist}|${payload.url}|${payload.isPlaying}`;
    if (signature === this.lastTrackSignature) {
      return;
    }

    this.lastTrackSignature = signature;
    console.log(
      `[WaveRPC SoundCloud Detector] Emitting update: "${payload.title}" by ${payload.artist} [Playing: ${payload.isPlaying}]`
    );

    this.sendToBackground({
      type: 'TRACK_UPDATE',
      payload,
    });
  }

  private setupDOMObserver(): void {
    const targetNode = document.querySelector('.playControls') || document.body;
    this.observer = new MutationObserver(() => {
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
        audio.addEventListener(evtName, () => this.detectAndSend());
      });
    };

    const existingAudio = document.querySelector<HTMLAudioElement>('audio');
    if (existingAudio) {
      attachToAudio(existingAudio);
    }

    const bodyObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'AUDIO') {
            attachToAudio(node as HTMLAudioElement);
          }
        });
      });
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  private sendToBackground(message: unknown): void {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(message, (_response: unknown) => {
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
