import { io, type Socket } from 'socket.io-client';

/**
 * One shared connection. The server pushes bet + game updates after every
 * poll, so the dashboard never needs a refresh (spec §26).
 */
export const socket: Socket = io({ transports: ['websocket', 'polling'] });
