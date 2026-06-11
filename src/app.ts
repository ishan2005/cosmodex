import express from 'express';
import cors from 'cors';
import { prisma } from './config/db.js';
import { RedisService } from './services/redis.service.js';
import { logger } from './config/logger.js';

const app = express();

app.use(cors());
app.use(express.json());

// Simple Morgan-style logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// GET /api/problems - Lists seeded coding challenges
app.get('/api/problems', async (req, res) => {
  try {
    const problems = await prisma.problem.findMany({
      include: {
        testCases: {
          where: { isPublic: true }, // Hide private cases in listing
        },
      },
    });
    res.status(200).json(problems);
  } catch (error) {
    logger.error(`REST Error fetching problems: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/room/:roomId - Check active room status from Redis cache
app.get('/api/room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  try {
    const state = await RedisService.getRoomState(roomId);
    if (!state) {
      return res.status(404).json({ error: 'Lobby not found or expired' });
    }
    res.status(200).json(state);
  } catch (error) {
    logger.error(`REST Error fetching room ${roomId}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:userId - Fetch user metadata and ELO rating
app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        eloRating: true,
        createdAt: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    logger.error(`REST Error fetching user ${userId}: ${error}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
