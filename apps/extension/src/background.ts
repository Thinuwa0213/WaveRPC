import { Track } from '@waverpc/shared';

console.log('[WaveRPC Extension] Background service worker initialized.');

declare const chrome: any;

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message: { type: string; payload?: Track },
      _sender: unknown,
      sendResponse: (res?: unknown) => void
    ) => {
      if (message.type === 'TRACK_UPDATE') {
        console.log('[WaveRPC Extension] Track update received:', message.payload);
        sendResponse({ status: 'ok' });
      }
      return true;
    }
  );
}
