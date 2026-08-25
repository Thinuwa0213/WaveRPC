import { ExtensionWSClient } from './websocket/client.js';
import { ExtensionTrackPayload, ExtensionPlaybackPayload } from './websocket/messages.js';

console.log('[WaveRPC Extension] Background service worker initializing...');

const wsClient = new ExtensionWSClient();
wsClient.connect();

declare const chrome: any;

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message:
        | { type: 'TRACK_UPDATE'; payload: ExtensionTrackPayload }
        | { type: 'PLAYBACK_UPDATE'; payload: ExtensionPlaybackPayload },
      _sender: unknown,
      sendResponse: (res?: unknown) => void
    ) => {
      if (!message || typeof message.type !== 'string') {
        sendResponse({ status: 'error', message: 'Invalid message payload' });
        return true;
      }

      switch (message.type) {
        case 'TRACK_UPDATE': {
          console.log(
            '[WaveRPC Background] Forwarding TRACK_UPDATE to Desktop Bridge:',
            message.payload
          );
          const sent = wsClient.sendTrackUpdate(message.payload);
          sendResponse({ status: sent ? 'ok' : 'failed' });
          break;
        }

        case 'PLAYBACK_UPDATE': {
          console.log(
            '[WaveRPC Background] Forwarding PLAYBACK_UPDATE to Desktop Bridge:',
            message.payload
          );
          const sent = wsClient.sendPlaybackUpdate(message.payload);
          sendResponse({ status: sent ? 'ok' : 'failed' });
          break;
        }

        default:
          sendResponse({ status: 'ignored' });
          break;
      }

      return true;
    }
  );
}
