import http from 'http';
import app from './app.js';
import { initSocketIO } from './sockets/index.js';
import { logger } from './config/logger.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Bind Socket.io to the HTTP server
initSocketIO(server);

server.listen(PORT, () => {
  logger.info(`=== COSMODEX BACKEND BOOTED ===`);
  logger.info(`Server is running on HTTP http://localhost:${PORT}`);
  logger.info(`WebSocket Gateway bound to http://localhost:${PORT}`);
});
