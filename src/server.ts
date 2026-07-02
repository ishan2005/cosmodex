import http from 'http';
import app from './app.js';
import { initSocketIO } from './sockets/index.js';
import { logger } from './config/logger.js';
import { redis } from './config/redis.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Bind Socket.io to the HTTP server
initSocketIO(server);

// Wait for Redis connection to resolve (either connect or fall back to InMemory)
// before accepting requests. This prevents the race condition where game
// operations run against a failing Redis client.
redis.waitForReady().then(() => {
  server.listen(PORT, () => {
    logger.info(`=== COSMODEX BACKEND BOOTED ===`);
    logger.info(`Server is running on HTTP http://localhost:${PORT}`);
    logger.info(`WebSocket Gateway bound to http://localhost:${PORT}`);
  });
});
