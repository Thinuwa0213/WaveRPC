const Module = require('module');
const originalRequire = Module.prototype.require;

let mockElectronInstance: any = null;
Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    if (!mockElectronInstance) {
      mockElectronInstance = {
        app: {
          requestSingleInstanceLock: () => true,
          on: () => {},
          whenReady: async () => {},
          getVersion: () => '1.0.0',
          getPath: () => '',
          isPackaged: false,
        },
        ipcMain: {
          handle: () => {},
        },
      };
    }
    return mockElectronInstance;
  }
  return originalRequire.apply(this, arguments);
};

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { StatusService } from './status.service.js';
import { WaveRPCDesktopApp } from '../main/index.js';
import { TypedEventEmitter, Track } from '@waverpc/shared';

class MockDiscordService {
  public connected = false;
  public isConnected() {
    return this.connected;
  }
}

class MockWsServer {
  public clientsCount = 0;
  public hasConnectedClients() {
    return this.clientsCount > 0;
  }
}

describe('StatusService Tests', () => {
  let events: TypedEventEmitter;
  let discordService: MockDiscordService;
  let wsServer: MockWsServer;
  let service: StatusService;
  let emittedSnapshots: any[];

  beforeEach(() => {
    events = new TypedEventEmitter();
    discordService = new MockDiscordService();
    wsServer = new MockWsServer();
    service = new StatusService(events, discordService as any, wsServer as any);
    emittedSnapshots = [];
    events.on('status:changed', (status) => {
      emittedSnapshots.push(status);
    });
  });

  it('1. Initial status defaults', () => {
    service.initialize();
    const status = service.getStatus();
    assert.strictEqual(status.discord.connected, false);
    assert.strictEqual(status.extension.connected, false);
    assert.strictEqual(status.provider.active, false);
    assert.strictEqual(status.app.running, true);
    assert.strictEqual(status.track, undefined);
  });

  it('2. Discord connected transition', () => {
    service.initialize();
    emittedSnapshots = [];
    events.emit('discord:connected');
    const status = service.getStatus();
    assert.strictEqual(status.discord.connected, true);
    assert.strictEqual(emittedSnapshots.length, 1);
    assert.strictEqual(emittedSnapshots[0].discord.connected, true);
  });

  it('3. Discord disconnected transition', () => {
    discordService.connected = true;
    service.initialize();
    emittedSnapshots = [];
    events.emit('discord:disconnected');
    const status = service.getStatus();
    assert.strictEqual(status.discord.connected, false);
    assert.strictEqual(emittedSnapshots.length, 1);
    assert.strictEqual(emittedSnapshots[0].discord.connected, false);
  });

  it('4. Extension connected transition', () => {
    service.initialize();
    emittedSnapshots = [];
    events.emit('extension:connected');
    const status = service.getStatus();
    assert.strictEqual(status.extension.connected, true);
    assert.strictEqual(emittedSnapshots.length, 1);
    assert.strictEqual(emittedSnapshots[0].extension.connected, true);
  });

  it('5. Final extension disconnect clears extension status', () => {
    service.initialize();
    events.emit('extension:connected');
    assert.strictEqual(service.getStatus().extension.connected, true);

    wsServer.clientsCount = 0;
    emittedSnapshots = [];
    events.emit('extension:disconnected');
    const status = service.getStatus();
    assert.strictEqual(status.extension.connected, false);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('6. Final extension disconnect clears provider', () => {
    service.initialize();
    events.emit('extension:connected');
    events.emit('provider:activated', 'soundcloud');
    assert.strictEqual(service.getStatus().provider.active, true);
    assert.strictEqual(service.getStatus().provider.id, 'soundcloud');

    wsServer.clientsCount = 0;
    emittedSnapshots = [];
    events.emit('extension:disconnected');
    let status = service.getStatus();
    assert.strictEqual(status.provider.active, true);
    assert.strictEqual(status.provider.id, 'soundcloud');

    events.emit('provider:deactivated', 'soundcloud');
    status = service.getStatus();
    assert.strictEqual(status.provider.active, false);
    assert.strictEqual(status.provider.id, undefined);
    assert.strictEqual(status.provider.name, undefined);
  });

  it('7. Final extension disconnect clears active track', () => {
    service.initialize();
    events.emit('extension:connected');
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    events.emit('track:changed', mockTrack);
    assert.ok(service.getStatus().track);

    wsServer.clientsCount = 0;
    emittedSnapshots = [];
    events.emit('extension:disconnected');
    let status = service.getStatus();
    assert.ok(status.track);

    events.emit('track:changed', undefined);
    status = service.getStatus();
    assert.strictEqual(status.track, undefined);
  });

  it('8. Provider activation', () => {
    service.initialize();
    emittedSnapshots = [];
    events.emit('provider:activated', 'soundcloud');
    const status = service.getStatus();
    assert.strictEqual(status.provider.active, true);
    assert.strictEqual(status.provider.id, 'soundcloud');
    assert.strictEqual(status.provider.name, 'SoundCloud');
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('9. Provider deactivation', () => {
    service.initialize();
    events.emit('provider:activated', 'soundcloud');
    emittedSnapshots = [];
    events.emit('provider:deactivated', 'soundcloud');
    const status = service.getStatus();
    assert.strictEqual(status.provider.active, false);
    assert.strictEqual(status.provider.id, undefined);
    assert.strictEqual(status.provider.name, undefined);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('10. Track metadata update', () => {
    service.initialize();
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    emittedSnapshots = [];
    events.emit('track:changed', mockTrack);
    const status = service.getStatus();
    assert.ok(status.track);
    assert.strictEqual(status.track.title, 'Midnight City');
    assert.strictEqual(status.track.artist, 'M83');
    assert.strictEqual(status.track.isPlaying, true);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('11. Playback Playing -> Paused', () => {
    service.initialize();
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    events.emit('track:changed', mockTrack);
    emittedSnapshots = [];
    events.emit('playback:stateChanged', 'paused');
    const status = service.getStatus();
    assert.ok(status.track);
    assert.strictEqual(status.track.isPlaying, false);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('12. Playback Paused -> Playing', () => {
    service.initialize();
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: false,
    };
    events.emit('track:changed', mockTrack);
    emittedSnapshots = [];
    events.emit('playback:stateChanged', 'playing');
    const status = service.getStatus();
    assert.ok(status.track);
    assert.strictEqual(status.track.isPlaying, true);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('13. track:changed(undefined) clears track', () => {
    service.initialize();
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    events.emit('track:changed', mockTrack);
    emittedSnapshots = [];
    events.emit('track:changed', undefined);
    const status = service.getStatus();
    assert.strictEqual(status.track, undefined);
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('14. Status snapshots are immutable/safe copies', () => {
    service.initialize();
    const snapshot1 = service.getStatus();
    snapshot1.app.running = false;
    assert.strictEqual(service.getStatus().app.running, true);
  });

  it('15. status:changed is emitted for meaningful state changes', () => {
    service.initialize();
    emittedSnapshots = [];
    events.emit('discord:connected');
    assert.strictEqual(emittedSnapshots.length, 1);
  });

  it('16. No unnecessary status notification for an effective no-op where practical', () => {
    service.initialize();
    emittedSnapshots = [];
    events.emit('discord:disconnected');
    assert.strictEqual(emittedSnapshots.length, 0);

    events.emit('discord:connected');
    emittedSnapshots = [];
    events.emit('discord:connected');
    assert.strictEqual(emittedSnapshots.length, 0);
  });

  it('17. Multi-client safety: does not clear on partial disconnects', () => {
    service.initialize();
    wsServer.clientsCount = 2;
    events.emit('extension:connected');
    events.emit('provider:activated', 'soundcloud');
    const mockTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
    };
    events.emit('track:changed', mockTrack);

    wsServer.clientsCount = 1;
    emittedSnapshots = [];
    events.emit('extension:disconnected');

    assert.strictEqual(service.getStatus().extension.connected, true);
    assert.strictEqual(service.getStatus().provider.active, true);
    assert.ok(service.getStatus().track);
    assert.strictEqual(emittedSnapshots.length, 0);

    wsServer.clientsCount = 0;
    emittedSnapshots = [];
    events.emit('extension:disconnected');

    // Extension connected status is false, but provider and track are temporarily preserved
    assert.strictEqual(service.getStatus().extension.connected, false);
    assert.strictEqual(service.getStatus().provider.active, true);
    assert.ok(service.getStatus().track);
    assert.strictEqual(emittedSnapshots.length, 1);

    // Cleared when change events are emitted
    events.emit('track:changed', undefined);
    events.emit('provider:deactivated', 'soundcloud');
    assert.strictEqual(service.getStatus().provider.active, false);
    assert.strictEqual(service.getStatus().track, undefined);
  });

  it('18. Full disconnect regression flow: final disconnect triggers cleanups', async () => {
    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 0 });
    try {
      const appEvents = app.getEvents();

      let hasClients = true;
      (app as any).wsServer.start = async () => true;
      (app as any).wsServer.stop = async () => {};
      (app as any).wsServer.hasConnectedClients = () => hasClients;

      const pm = (app as any).discordService.presenceManager;
      let setActivityCount = 0;
      let clearActivityCount = 0;

      (pm.rpcClient as any).state = 'CONNECTED';
      pm.rpcClient.connect = async () => true;
      pm.rpcClient.disconnect = async () => {};
      pm.rpcClient.setActivity = async (act: any) => {
        if (act === null) {
          clearActivityCount++;
        } else {
          setActivityCount++;
        }
        return true;
      };
      pm.rpcClient.clearActivity = async () => {
        clearActivityCount++;
        return true;
      };

      (app as any).discordService.isConnected = () => true;

      await app.bootstrap();

      appEvents.emit('extension:connected');
      appEvents.emit('provider:activated', 'soundcloud');
      const mockTrack: Track = {
        title: 'Midnight City',
        artist: 'M83',
        url: 'https://soundcloud.com/m83/midnight-city',
        isPlaying: true,
      };
      appEvents.emit('track:changed', mockTrack);
      // Allow asynchronous presence update promise to settle so isPresenceCleared becomes false
      await new Promise((resolve) => setTimeout(resolve, 10));

      const status1 = app.getStatusService().getStatus();
      assert.strictEqual(status1.extension.connected, true);
      assert.strictEqual(status1.provider.active, true);
      assert.ok(status1.track);
      assert.strictEqual(status1.track.title, 'Midnight City');
      assert.ok(setActivityCount > 0);

      // Simulate final disconnect
      hasClients = false;
      appEvents.emit('extension:disconnected');

      const status2 = app.getStatusService().getStatus();
      assert.strictEqual(status2.extension.connected, false);
      assert.strictEqual(status2.provider.active, false);
      assert.strictEqual(status2.track, undefined);
      assert.strictEqual(clearActivityCount, 1);
    } finally {
      await app.shutdown();
    }
  });

  it('19. Default real runtime bootstrap should not activate MockProvider', async () => {
    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 0 });
    try {
      // Stub servers/services so we don't start real sockets/connections
      (app as any).wsServer.start = async () => true;
      (app as any).wsServer.stop = async () => {};
      (app as any).discordService.connect = async () => true;
      (app as any).discordService.disconnect = async () => {};

      await app.bootstrap();

      const status = app.getStatusService().getStatus();
      assert.strictEqual(status.provider.active, false, 'Should start with no active provider');
      assert.strictEqual(status.track, undefined, 'Should start with no active track');
    } finally {
      await app.shutdown();
    }
  });

  it('20. Bootstrap with WAVERPC_DEV_MOCK=true should activate MockProvider', async () => {
    const app = new WaveRPCDesktopApp({ disconnectGracePeriodMs: 0 });

    // Stub servers/services
    (app as any).wsServer.start = async () => true;
    (app as any).wsServer.stop = async () => {};
    (app as any).discordService.connect = async () => true;
    (app as any).discordService.disconnect = async () => {};

    process.env.WAVERPC_DEV_MOCK = 'true';
    try {
      await app.bootstrap();
      const status = app.getStatusService().getStatus();
      assert.strictEqual(status.provider.active, true, 'Should activate provider when flag is set');
      assert.strictEqual(
        status.track?.title,
        'Synthwave Dreams',
        'Should set mock track when flag is set'
      );
    } finally {
      delete process.env.WAVERPC_DEV_MOCK;
      await app.shutdown();
    }
  });

  it('21. App version resolution fallback: should not return 0.0.0 in dev fallback path', () => {
    const { resolveAppVersion } = require('../main/app-version.js');
    const version = resolveAppVersion();
    assert.ok(
      version && version !== '0.0.0',
      'Resolved version should match the desktop package.json version'
    );
    const expectedVersion = require('../../package.json').version;
    assert.strictEqual(
      version,
      expectedVersion,
      'Resolved version must match desktop package version exactly'
    );
  });

  it('22. App version resolution: should return app.getVersion() when packaged', () => {
    const { resolveAppVersion } = require('../main/app-version.js');
    const electron = require('electron');

    // Temporarily mock isPackaged and getVersion
    electron.app.isPackaged = true;
    const originalGetVersion = electron.app.getVersion;
    electron.app.getVersion = () => '1.2.3';

    try {
      const version = resolveAppVersion();
      assert.strictEqual(
        version,
        '1.2.3',
        'Should return packaged version when app.isPackaged is true'
      );
    } finally {
      electron.app.isPackaged = false;
      electron.app.getVersion = originalGetVersion;
    }
  });

  it('23. App version resolution: should fallback to package version when packaged but getVersion is 0.0.0', () => {
    const { resolveAppVersion } = require('../main/app-version.js');
    const electron = require('electron');

    electron.app.isPackaged = true;
    const originalGetVersion = electron.app.getVersion;
    electron.app.getVersion = () => '0.0.0';

    try {
      const version = resolveAppVersion();
      const expectedVersion = require('../../package.json').version;
      assert.strictEqual(
        version,
        expectedVersion,
        'Should fallback to package.json version if getVersion is 0.0.0'
      );
    } finally {
      electron.app.isPackaged = false;
      electron.app.getVersion = originalGetVersion;
    }
  });

  it('24. App version resolution: package.json missing/invalid safe fallback', () => {
    const { resolveAppVersion } = require('../main/app-version.js');
    const electron = require('electron');
    const fs = require('fs');

    const originalExistsSync = fs.existsSync;
    fs.existsSync = () => false; // Simulate missing package.json

    const originalGetVersion = electron.app.getVersion;
    electron.app.getVersion = () => '0.0.0-dev-fallback';

    try {
      const version = resolveAppVersion();
      assert.strictEqual(
        version,
        '0.0.0-dev-fallback',
        'Should fallback to app.getVersion() if package.json does not exist'
      );
    } finally {
      fs.existsSync = originalExistsSync;
      electron.app.getVersion = originalGetVersion;
    }
  });
});
