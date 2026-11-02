import { EventEmitter } from 'node:events';
import type { BusMsg } from '../shared/types.js';

export type { BusMsg } from '../shared/types.js';

export class Bus {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  on(fn: (m: BusMsg) => void): () => void {
    this.emitter.on('message', fn);
    return () => { this.emitter.off('message', fn); };
  }

  emit(m: BusMsg): void {
    this.emitter.emit('message', m);
  }
}
