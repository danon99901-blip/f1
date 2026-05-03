// Signaling server entry point

import { SignalingServer } from './SignalingServer.js';

const PORT = parseInt(process.env.WS_PORT || '3001');

new SignalingServer(PORT);

console.log(`[Server] Signaling server started on port ${PORT}`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Server] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  process.exit(0);
});
