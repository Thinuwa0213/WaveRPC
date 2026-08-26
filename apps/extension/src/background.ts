import { ExtensionWSClient } from './websocket/client.js';
import { ExtensionTrackPayload, ExtensionPlaybackPayload } from './websocket/messages.js';
import { Logger } from '@waverpc/shared';

const log = new Logger('ExtensionBackground');

log.info('Background service worker initializing...');

const wsClient = new ExtensionWSClient();
wsClient.connect();

declare const chrome: any;

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message:
        | { type: 'TRACK_UPDATE'; payload: ExtensionTrackPayload }
        | { type: 'PLAYBACK_UPDATE'; payload: ExtensionPlaybackPayload }
        | { type: 'TRACK_CLEAR' },
      _sender: unknown,
      sendResponse: (res?: unknown) => void
    ) => {
      if (!message || typeof message.type !== 'string') {
        log.warn('Rejected invalid message from content script.');
        sendResponse({ status: 'error', message: 'Invalid message payload' });
        return true;
      }

      log.debug('Incoming content-script message type:', message.type);

      switch (message.type) {
        case 'TRACK_UPDATE': {
          log.info('Forwarding TRACK_UPDATE to Desktop Bridge...');
          const sent = wsClient.sendTrackUpdate(message.payload);
          log.info(`TRACK_UPDATE forward ${sent ? 'succeeded' : 'failed'}.`);
          sendResponse({ status: sent ? 'ok' : 'failed' });
          break;
        }

        case 'PLAYBACK_UPDATE': {
          log.info('Forwarding PLAYBACK_UPDATE to Desktop Bridge...');
          const sent = wsClient.sendPlaybackUpdate(message.payload);
          log.info(`PLAYBACK_UPDATE forward ${sent ? 'succeeded' : 'failed'}.`);
          sendResponse({ status: sent ? 'ok' : 'failed' });
          break;
        }

        case 'TRACK_CLEAR': {
          log.info('Forwarding TRACK_CLEAR to Desktop Bridge...');
          const sent = wsClient.sendTrackClear();
          log.info(`TRACK_CLEAR forward ${sent ? 'succeeded' : 'failed'}.`);
          sendResponse({ status: sent ? 'ok' : 'failed' });
          break;
        }

        default:
          log.warn(`Unknown message type ignored: ${(message as { type: string }).type}`);
          sendResponse({ status: 'ignored' });
          break;
      }

      return true;
    }
  );
}
