interface AppInfo {
  name: string;
  version: string;
}

interface WaveRPCStatus {
  discord: {
    connected: boolean;
  };
  extension: {
    connected: boolean;
  };
  provider: {
    id?: string;
    name?: string;
    active: boolean;
  };
  track?: {
    title: string;
    artist: string;
    artwork?: string;
    isPlaying: boolean;
  };
  app: {
    running: boolean;
  };
}

interface WaveRPCSettings {
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  startMinimized: boolean;
}

interface Window {
  waverpc?: {
    getAppInfo: () => Promise<AppInfo>;
    getStatus: () => Promise<WaveRPCStatus>;
    onStatusChanged: (callback: (status: WaveRPCStatus) => void) => () => void;
    getSettings: () => Promise<WaveRPCSettings>;
    updateSetting: (key: string, value: boolean) => Promise<{ success: boolean }>;
    onSettingsChanged: (callback: (settings: WaveRPCSettings) => void) => () => void;
  };
}

interface SettingState {
  key: keyof WaveRPCSettings;
  input: HTMLInputElement | null;
  feedback: HTMLElement | null;
  isSaving: boolean;
  feedbackTimeout: any;
}

const settingsState: Record<keyof WaveRPCSettings, SettingState> = {
  minimizeToTray: {
    key: 'minimizeToTray',
    input: null,
    feedback: null,
    isSaving: false,
    feedbackTimeout: null,
  },
  launchAtStartup: {
    key: 'launchAtStartup',
    input: null,
    feedback: null,
    isSaving: false,
    feedbackTimeout: null,
  },
  startMinimized: {
    key: 'startMinimized',
    input: null,
    feedback: null,
    isSaving: false,
    feedbackTimeout: null,
  },
};

function renderSettings(settings: WaveRPCSettings) {
  for (const key of Object.keys(settingsState) as Array<keyof WaveRPCSettings>) {
    const state = settingsState[key];
    if (!state.input) continue;

    // If an incoming settings snapshot is received while saving, canonical wins
    if (state.isSaving) {
      state.isSaving = false;
      state.input.disabled = false;
      if (state.feedback) {
        state.feedback.textContent = '';
        state.feedback.className = 'saving-feedback';
      }
    }

    state.input.checked = settings[key];
  }
}

async function saveSetting(key: keyof WaveRPCSettings, value: boolean) {
  const state = settingsState[key];
  if (!state.input) return;

  // Cancel any old feedback timer for this setting to prevent state overlap
  if (state.feedbackTimeout) {
    clearTimeout(state.feedbackTimeout);
    state.feedbackTimeout = null;
  }

  state.isSaving = true;
  state.input.disabled = true;

  if (state.feedback) {
    state.feedback.textContent = 'Saving...';
    state.feedback.className = 'saving-feedback saving';
  }

  try {
    const response = await window.waverpc!.updateSetting(key, value);

    // If this transaction was cancelled by onSettingsChanged in the meantime, return early
    if (!state.isSaving) {
      return;
    }

    if (response && response.success) {
      if (state.feedback) {
        state.feedback.textContent = 'Saved';
        state.feedback.className = 'saving-feedback success';
      }

      state.feedbackTimeout = setTimeout(() => {
        if (state.feedback) {
          state.feedback.textContent = '';
          state.feedback.className = 'saving-feedback';
        }
        state.feedbackTimeout = null;
      }, 2000);
    } else {
      throw new Error('Save rejected by backend');
    }
  } catch (error) {
    console.error(`[Renderer] Failed to update setting ${key}:`, error);

    if (!state.isSaving) {
      return;
    }

    // Revert checkbox state
    state.input.checked = !value;

    if (state.feedback) {
      state.feedback.textContent = 'Could not save setting';
      state.feedback.className = 'saving-feedback error';
    }

    state.feedbackTimeout = setTimeout(() => {
      if (state.feedback) {
        state.feedback.textContent = '';
        state.feedback.className = 'saving-feedback';
      }
      state.feedbackTimeout = null;
    }, 3000);
  } finally {
    if (state.isSaving) {
      state.isSaving = false;
      state.input.disabled = false;
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const versionBadge = document.getElementById('version-badge');

  // Setup artwork error listener for fallback
  const trackArtwork = document.getElementById('track-artwork') as HTMLImageElement | null;
  const artworkPlaceholder = document.getElementById('artwork-placeholder');
  if (trackArtwork) {
    trackArtwork.addEventListener('error', () => {
      trackArtwork.classList.add('hidden');
      trackArtwork.removeAttribute('src');
      if (artworkPlaceholder) {
        artworkPlaceholder.classList.remove('hidden');
      }
    });
  }

  // Bind settings DOM elements
  settingsState.minimizeToTray.input = document.getElementById(
    'setting-minimizeToTray'
  ) as HTMLInputElement | null;
  settingsState.minimizeToTray.feedback = document.getElementById('feedback-minimizeToTray');

  settingsState.launchAtStartup.input = document.getElementById(
    'setting-launchAtStartup'
  ) as HTMLInputElement | null;
  settingsState.launchAtStartup.feedback = document.getElementById('feedback-launchAtStartup');

  settingsState.startMinimized.input = document.getElementById(
    'setting-startMinimized'
  ) as HTMLInputElement | null;
  settingsState.startMinimized.feedback = document.getElementById('feedback-startMinimized');

  // Register switch toggle event listeners
  for (const key of Object.keys(settingsState) as Array<keyof WaveRPCSettings>) {
    const state = settingsState[key];
    if (state.input) {
      state.input.addEventListener('change', () => {
        saveSetting(key, state.input!.checked);
      });
    }
  }

  const waverpc = (window as Window).waverpc;
  if (waverpc) {
    try {
      const appInfo = await waverpc.getAppInfo();
      if (versionBadge && appInfo && appInfo.version) {
        versionBadge.textContent = `v${appInfo.version}`;
      }
    } catch (err) {
      console.error('[Renderer] Failed to retrieve app metadata:', err);
      if (versionBadge) {
        versionBadge.textContent = 'vError';
      }
    }

    // 1. Subscribe to status changes first to prevent race condition
    waverpc.onStatusChanged((status) => {
      updateUI(status);
    });

    // 2. Retrieve initial status second
    try {
      const initialStatus = await waverpc.getStatus();
      updateUI(initialStatus);
    } catch (err) {
      console.error('[Renderer] Failed to retrieve initial status:', err);
    }

    // 3. Subscribe to settings changes
    waverpc.onSettingsChanged((settings) => {
      renderSettings(settings);
    });

    // 4. Retrieve initial settings
    try {
      const initialSettings = await waverpc.getSettings();
      renderSettings(initialSettings);
    } catch (err) {
      console.error('[Renderer] Failed to retrieve initial settings:', err);
    }
  } else {
    console.warn('[Renderer] waverpc preload bridge is not available.');
    if (versionBadge) {
      versionBadge.textContent = 'vOffline';
    }

    // Disable settings checkboxes since API is unavailable
    for (const key of Object.keys(settingsState) as Array<keyof WaveRPCSettings>) {
      const state = settingsState[key];
      if (state.input) {
        state.input.disabled = true;
      }
    }
  }
});

function updateUI(status: WaveRPCStatus) {
  if (!status) return;

  // Discord Connection Card
  const discordBadge = document.getElementById('discord-status-badge');
  const discordText = document.getElementById('discord-status-text');
  if (discordBadge && discordText) {
    if (status.discord.connected) {
      discordBadge.textContent = 'Connected';
      discordBadge.className = 'badge badge-success';
      discordText.textContent = 'Online';
    } else {
      discordBadge.textContent = 'Disconnected';
      discordBadge.className = 'badge badge-muted';
      discordText.textContent = 'Offline';
    }
  }

  // Browser Extension Card
  const extensionBadge = document.getElementById('extension-status-badge');
  const extensionText = document.getElementById('extension-status-text');
  if (extensionBadge && extensionText) {
    if (status.extension.connected) {
      extensionBadge.textContent = 'Connected';
      extensionBadge.className = 'badge badge-success';
      extensionText.textContent = 'Extension Connected';
    } else {
      extensionBadge.textContent = 'Waiting';
      extensionBadge.className = 'badge badge-warning';
      extensionText.textContent = 'No Extension Connected';
    }
  }

  // Active Provider Card
  const providerBadge = document.getElementById('provider-status-badge');
  const providerText = document.getElementById('provider-status-text');
  if (providerBadge && providerText) {
    if (status.provider.active && status.provider.name) {
      providerBadge.textContent = 'Active';
      providerBadge.className = 'badge badge-success';
      providerText.textContent = `${status.provider.name} Active`;
    } else {
      providerBadge.textContent = 'Inactive';
      providerBadge.className = 'badge badge-muted';
      providerText.textContent = 'No Active Provider';
    }
  }

  // Now Playing section
  const trackEmpty = document.getElementById('track-empty');
  const trackActive = document.getElementById('track-active');

  if (status.track) {
    // 1. Hide empty layout, show track container
    if (trackEmpty) trackEmpty.classList.add('hidden');
    if (trackActive) trackActive.classList.remove('hidden');

    // 2. Set details securely using textContent
    const trackTitle = document.getElementById('track-title');
    if (trackTitle) {
      trackTitle.textContent = status.track.title || 'Unknown Title';
    }

    const trackArtist = document.getElementById('track-artist');
    if (trackArtist) {
      trackArtist.textContent = status.track.artist || 'Unknown Artist';
    }

    const trackPlaybackState = document.getElementById('track-playback-state');
    if (trackPlaybackState) {
      trackPlaybackState.textContent = status.track.isPlaying ? 'Playing' : 'Paused';
      trackPlaybackState.className = status.track.isPlaying
        ? 'badge badge-success'
        : 'badge badge-warning';
    }

    const trackProviderBadge = document.getElementById('track-provider-badge');
    if (trackProviderBadge) {
      trackProviderBadge.textContent = status.provider.name || 'SoundCloud';
    }

    const trackArtwork = document.getElementById('track-artwork') as HTMLImageElement | null;
    const artworkPlaceholder = document.getElementById('artwork-placeholder');
    if (trackArtwork) {
      if (status.track.artwork) {
        trackArtwork.src = status.track.artwork;
        trackArtwork.classList.remove('hidden');
        if (artworkPlaceholder) artworkPlaceholder.classList.add('hidden');
      } else {
        trackArtwork.removeAttribute('src');
        trackArtwork.classList.add('hidden');
        if (artworkPlaceholder) artworkPlaceholder.classList.remove('hidden');
      }
    }
  } else {
    // Clean up to prevent stale data leaking
    const trackTitle = document.getElementById('track-title');
    if (trackTitle) trackTitle.textContent = '';

    const trackArtist = document.getElementById('track-artist');
    if (trackArtist) trackArtist.textContent = '';

    const trackPlaybackState = document.getElementById('track-playback-state');
    if (trackPlaybackState) {
      trackPlaybackState.textContent = '';
      trackPlaybackState.className = 'badge';
    }

    const trackArtwork = document.getElementById('track-artwork') as HTMLImageElement | null;
    if (trackArtwork) {
      trackArtwork.removeAttribute('src');
      trackArtwork.classList.add('hidden');
    }

    const artworkPlaceholder = document.getElementById('artwork-placeholder');
    if (artworkPlaceholder) artworkPlaceholder.classList.remove('hidden');

    // 3. Show empty layout, hide track container
    if (trackEmpty) trackEmpty.classList.remove('hidden');
    if (trackActive) trackActive.classList.add('hidden');
  }
}
