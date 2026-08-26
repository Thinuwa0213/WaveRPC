export interface PresenceTimestamps {
  start?: number;
  end?: number;
}

export interface PresenceAssets {
  large_image?: string;
  large_text?: string;
  small_image?: string;
  small_text?: string;
}

export interface PresenceButton {
  label: string;
  url: string;
}

export interface DiscordActivityPayload {
  details: string;
  state: string;
  timestamps?: PresenceTimestamps;
  assets?: PresenceAssets;
  buttons?: PresenceButton[];
  instance?: boolean;
  type?: number;
}

export interface PresenceManagerOptions {
  clientId: string;
  defaultLargeImage?: string;
  defaultLargeText?: string;
}
