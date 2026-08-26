export interface WaveRPCStatus {
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
