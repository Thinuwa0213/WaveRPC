import { ExtensionWSClient } from './websocket/client.js';
import { Logger } from '@waverpc/shared';
import { SoundCloudTabStateManager } from './background/soundcloud-tab-state.js';

const log = new Logger('ExtensionBackground');

log.info('Background service worker initializing...');

declare const chrome: any;

function isValidSoundCloudOrigin(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'soundcloud.com' || parsed.hostname.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

const wsClient = new ExtensionWSClient();

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

function requestLivePlaybackState() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
    return;
  }
  log.info('Querying active SoundCloud documents for state resync...');
  chrome.tabs.query({ url: '*://*.soundcloud.com/*' }, (tabs: any[]) => {
    if (chrome.runtime.lastError) {
      log.warn('Error querying tabs:', chrome.runtime.lastError);
      return;
    }
    if (!tabs || tabs.length === 0) {
      log.info('No SoundCloud tabs found to query.');
      return;
    }
    log.info(`Found ${tabs.length} SoundCloud tab(s). Requesting state...`);
    tabs.forEach((tab: any) => {
      if (typeof tab.id === 'number') {
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_PLAYBACK_STATE' }, (response: any) => {
          if (chrome.runtime.lastError) {
            log.debug(`Failed to send message to tab ${tab.id}:`, chrome.runtime.lastError.message);
            return;
          }
          if (response && response.sourceSessionId) {
            log.info(`Received state from tab ${tab.id} / session ${response.sourceSessionId}`);
            if (response.payload) {
              log.info('[DEV-LOG] Background received resync state:', {
                playbackPosition: response.payload.playbackPosition,
                duration: response.payload.duration,
                isPlaying: response.payload.isPlaying,
                producer: response.producer || 'request-state',
              });
              tabStateManager.handleTrackUpdate(tab.id, response.sourceSessionId, response.payload);
            } else {
              tabStateManager.handleTrackClear(tab.id, response.sourceSessionId);
            }
          }
        });
      }
    });
  });
}

function ensureReconnectAlarm() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.get('reconnect-alarm', (alarm: any) => {
      if (!alarm) {
        log.info('Creating reconnect-alarm (1-minute period)...');
        chrome.alarms.create('reconnect-alarm', { periodInMinutes: 1 });
      }
    });
  }
}

function clearReconnectAlarm() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear('reconnect-alarm', (wasCleared: boolean) => {
      if (wasCleared) {
        log.info('reconnect-alarm cleared.');
      }
    });
  }
}

wsClient.onConnect = () => {
  log.info('WS connected. Clearing reconnect alarm and resyncing state...');
  clearReconnectAlarm();
  requestLivePlaybackState();
};

wsClient.onDisconnect = () => {
  log.info('WS disconnected. Ensuring reconnect alarm is active...');
  ensureReconnectAlarm();
};

wsClient.onRequestState = () => {
  log.info('Received REQUEST_STATE from Desktop Bridge. Querying tabs...');
  requestLivePlaybackState();
};

// Start connection and ensure reconnect alarm is configured
wsClient.connect();
ensureReconnectAlarm();

if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm: any) => {
    if (alarm.name === 'reconnect-alarm') {
      log.info('reconnect-alarm triggered. Checking connection state...');
      if (wsClient.connectionState === 'DISCONNECTED') {
        wsClient.connect();
      } else if (wsClient.connectionState === 'CONNECTED') {
        clearReconnectAlarm();
      }
    }
  });
}

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
      if (!isValidSoundCloudOrigin(changeInfo.url)) {
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

      const trustedUrl = sender.url || sender.tab?.url;
      if (!isValidSoundCloudOrigin(trustedUrl)) {
        log.warn(`Rejected message from untrusted origin: ${trustedUrl}`);
        sendResponse({ status: 'error', message: 'Untrusted origin' });
        return true;
      }

      if (message.type !== 'PING') {
        log.debug('Incoming content-script message type:', message.type);
      }

      if (wsClient.connectionState === 'DISCONNECTED') {
        log.info(
          `Content script message ${message.type} received while disconnected. Triggering immediate connect...`
        );
        wsClient.connect();
      }

      const tabId = sender?.tab?.id;
      const documentId = sender?.documentId;
      const sourceSessionId = message.sourceSessionId;

      const sourceId =
        typeof tabId === 'number'
          ? tabId
          : typeof documentId === 'string' && documentId
            ? documentId
            : sourceSessionId;

      switch (message.type) {
        case 'TRACK_UPDATE': {
          log.info('[DEV-LOG] Background received TRACK_UPDATE:', {
            playbackPosition: message.payload?.playbackPosition,
            duration: message.payload?.duration,
            isPlaying: message.payload?.isPlaying,
            producer: message.producer,
          });

          if (sourceId !== undefined && sourceId !== null && typeof sourceSessionId === 'string') {
            tabStateManager.handleTrackUpdate(
              sourceId,
              sourceSessionId,
              message.payload,
              trustedUrl
            );
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
          if (sourceId !== undefined && sourceId !== null && typeof sourceSessionId === 'string') {
            tabStateManager.handleTrackClear(sourceId, sourceSessionId);
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
