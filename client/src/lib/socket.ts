import { io, type Socket } from 'socket.io-client';

/**
 * One shared connection. The server pushes bet + game updates after every
 * poll, so the dashboard never needs a refresh (spec §26).
 */
export const socket: Socket = io({
  transports: ['websocket', 'polling'],
  // Held back until the app knows it has a session -- an unauthenticated
  // handshake is rejected and would retry in a loop behind the login screen.
  autoConnect: false,
});
