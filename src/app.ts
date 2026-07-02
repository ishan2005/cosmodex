import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import rateLimit from 'express-rate-limit';

import { prisma } from './config/db.js';
import { redis } from './config/redis.js';
import { RedisService } from './services/redis.service.js';
import { MatchService } from './services/match.service.js';
import { MatchmakingService } from './services/matchmaking.service.js';
import { logger } from './config/logger.js';

// Route modules
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import problemRoutes from './routes/problem.routes.js';
import adminRoutes from './routes/admin.routes.js';
import matchRoutes from './routes/match.routes.js';

// ── APP SETUP ────────────────────────────────────────────────────
const app = express();

// ── CORS ─────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── STATIC FILE SERVING ──────────────────────────────────────────
// Serves the /client folder at the root URL for the demo UI
app.use(express.static(path.join(process.cwd(), 'client')));

// ── REQUEST LOGGER ───────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ── RATE LIMITING ────────────────────────────────────────────────
// Auth endpoints: strict limit to prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: generous limit to allow normal usage
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Rate limit exceeded. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// ── HEALTH CHECK ─────────────────────────────────────────────────
// Checks DB + Redis connectivity and returns service status
app.get('/health', async (req: Request, res: Response) => {
  const [dbOk, cacheOk] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then((r) => r === 'PONG').catch(() => false),
  ]);

  const overallStatus = dbOk && cacheOk ? 'OK' : 'DEGRADED';
  const httpStatus = overallStatus === 'OK' ? 200 : 503;

  res.status(httpStatus).json({
    status: overallStatus,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: dbOk ? 'UP' : 'DOWN',
      cache: cacheOk ? 'UP' : 'DOWN',
    },
  });
});

// ── QUEUE STATUS (public) ────────────────────────────────────────
app.get('/api/queue', async (req: Request, res: Response) => {
  const status = await MatchmakingService.getQueueStatus();
  res.json(status);
});

// ── MOUNTED ROUTE MODULES ────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/matches', matchRoutes);

// ── ROOM ENDPOINTS ───────────────────────────────────────────────

// GET /api/room/:roomId — Fetch live room state from Redis cache
app.get('/api/room/:roomId', async (req: Request, res: Response) => {
  const roomId = req.params['roomId'] as string;
  const state = await RedisService.getRoomState(roomId);
  if (!state) {
    return res.status(404).json({ error: 'Room not found or has expired' });
  }
  res.json(state);
});

// POST /api/room — Create a new live match room (for demo / manual testing)
app.post('/api/room', async (req: Request, res: Response) => {
  const { player1Id, player2Id, problemIds } = req.body;

  if (!player1Id || !player2Id) {
    return res.status(400).json({ error: 'player1Id and player2Id are required' });
  }
  if (!Array.isArray(problemIds) || problemIds.length === 0) {
    return res.status(400).json({ error: 'problemIds must be a non-empty array' });
  }
  if (player1Id === player2Id) {
    return res.status(400).json({ error: 'player1Id and player2Id must be different users' });
  }

  const roomId = `room-${crypto.randomUUID()}`;
  const roomState = await MatchService.createRoomState(roomId, player1Id, player2Id, problemIds);

  logger.info(`Room created via REST: ${roomId} (${player1Id} vs ${player2Id})`);
  res.status(201).json(roomState);
});

// DELETE /api/room/:roomId — Force-close a room (admin/testing use)
app.delete('/api/room/:roomId', async (req: Request, res: Response) => {
  const roomId = req.params['roomId'] as string;
  const state = await RedisService.getRoomState(roomId);
  if (!state) {
    return res.status(404).json({ error: 'Room not found' });
  }
  await RedisService.deleteRoomState(roomId);
  logger.warn(`Room ${roomId} force-deleted via REST`);
  res.json({ message: `Room ${roomId} closed` });
});

// ── 404 HANDLER ──────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
  });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────────
// Express 5 automatically forwards async errors here — no try/catch needed in routes
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`);
  logger.error(err.stack ?? '');

  // JsonWebTokenError from verifyToken
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Prisma unique constraint violation (P2002)
  if ((err as any).code === 'P2002') {
    return res.status(409).json({ error: 'A record with that value already exists' });
  }

  // Prisma not-found (P2025)
  if ((err as any).code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
});

export default app;
