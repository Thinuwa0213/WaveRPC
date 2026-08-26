import { ExtensionWSClient } from './websocket/client.js';
import { Logger } from '@waverpc/shared';
import { SoundCloudTabStateManager } from './background/soundcloud-tab-state.js';

const log = new Logger('ExtensionBackground');

log.info('Background service worker initializing...');

const wsClient = new ExtensionWSClient();
wsClient.connect();

const tabStateManager = new SoundCloudTabStateManager({
  onTrackUpdate: (payload) => {
    log.info('Forwarding TRACK_UPDATE to Desktop Bridge...');
    const sent = wsClient.sendTrackUpdate(payload);
    log.info(`TRACK_UPDATE forward ${sent ? 'succeeded' : 'failed'}.`);
  },
  onTrackClear: () => {
    log.info('Forwarding TRACK_CLEAR to Desktop Bridge...');
    const sent = wsClient.sendTrackClear();
    log.info(`TRACK_CLEAR forward ${sent ? 'succeeded' : 'failed'}.`);
  },
});

declare const chrome: any;

if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    log.debug(`Tab removed: ${tabId}`);
    tabStateManager.handleTabRemoved(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any) => {
    if (changeInfo.status === 'loading') {
      log.debug(`Tab status changed to loading: ${tabId}`);
      tabStateManager.handleTabRemoved(tabId);
      return;
    }

    if (changeInfo.url !== undefined) {
      const isSoundCloud = changeInfo.url.includes('soundcloud.com');
      if (!isSoundCloud) {
        log.debug(`Tab ${tabId} navigated away from SoundCloud to: ${changeInfo.url}`);
        tabStateManager.handleTabRemoved(tabId);
      }
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: any, sender: any, sendResponse: (res?: unknown) => void) => {
      if (!message || typeof message.type !== 'string') {
        log.warn('Rejected invalid message from content script.');
        sendResponse({ status: 'error', message: 'Invalid message payload' });
        return true;
      }

      if (message.type !== 'PING') {
        log.debug('Incoming content-script message type:', message.type);
      }

      const tabId = sender?.tab?.id;
      const tabUrl = sender?.tab?.url;
      const sourceSessionId = message.sourceSessionId;

      switch (message.type) {
        case 'TRACK_UPDATE': {
          if (typeof tabId === 'number' && typeof sourceSessionId === 'string') {
            tabStateManager.handleTrackUpdate(tabId, sourceSessionId, message.payload, tabUrl);
            sendResponse({ status: 'ok' });
          } else {
            const sent = wsClient.sendTrackUpdate(message.payload);
            sendResponse({ status: sent ? 'ok' : 'failed' });
          }
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
          if (typeof tabId === 'number' && typeof sourceSessionId === 'string') {
            tabStateManager.handleTrackClear(tabId, sourceSessionId);
            sendResponse({ status: 'ok' });
          } else {
            const sent = wsClient.sendTrackClear();
            sendResponse({ status: sent ? 'ok' : 'failed' });
          }
          break;
        }

        case 'PING': {
          sendResponse({ status: 'ok' });
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
