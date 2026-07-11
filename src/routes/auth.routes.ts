import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';

const router = Router();

// ── Validation helpers ───────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * POST /api/auth/register
 * Creates a new user account and returns a JWT.
 * Body: { username, email, password }
 */
router.post('/register', async (req, res) => {
  try {
    const rawUsername = req.body.username;
    const rawEmail   = req.body.email;
    const password   = req.body.password;

    if (!rawUsername || !rawEmail || !password) {
      return res.status(400).json({ error: 'username, email, and password are required' });
    }

    // Sanitize inputs
    const username = String(rawUsername).trim();
    const email    = String(rawEmail).trim().toLowerCase();

    // Validate username: 3-20 chars, alphanumeric + underscores only
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores',
      });
    }

    // Validate email format
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check for duplicate username or email (use sanitized values)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
      select: { username: true, email: true },
    });

    if (existing) {
      const field = existing.username === username ? 'Username' : 'Email';
      return res.status(409).json({ error: `${field} is already taken` });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, passwordHash },
      select: { id: true, username: true, email: true, eloRating: true, mcqEloRating: true, role: true, createdAt: true },
    });

    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    logger.info(`New user registered: ${user.username} (${user.id})`);
    res.status(201).json({ user, token });
  } catch (err) {
    // Let Express 5 error handler deal with unexpected errors
    throw err;
  }
});

/**
 * POST /api/auth/login
 * Validates credentials and returns a JWT.
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const rawEmail = req.body.email;
    const password = req.body.password;

    if (!rawEmail || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // Normalize email — matches how register stores it
    const email = String(rawEmail).trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    logger.info(`User logged in: ${user.username} (${user.id})`);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        eloRating: user.eloRating,
        mcqEloRating: user.mcqEloRating,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    throw err;
  }
});

/**
 * POST /api/auth/logout
 * Client should discard the token. Included for API completeness.
 */
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out. Please discard your token on the client.' });
});

export default router;
