import { WaveRPCEvents, EventName } from './types.js';
export declare class TypedEventEmitter {
    private listeners;
    on<K extends EventName>(event: K, listener: WaveRPCEvents[K]): () => void;
    off<K extends EventName>(event: K, listener: WaveRPCEvents[K]): void;
    emit<K extends EventName>(event: K, ...args: Parameters<WaveRPCEvents[K]>): void;
    removeAllListeners(event?: EventName): void;
}
//# sourceMappingURL=event-emitter.d.ts.map