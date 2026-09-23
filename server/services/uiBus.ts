import { EventEmitter } from 'events';

/** Cross-cutting UI events (notifications, etc.) for Socket.IO bridge. */
export const uiBus = new EventEmitter();
