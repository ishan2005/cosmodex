import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../config/jwt.js';
import { logger } from '../config/logger.js';

// Extend Express Request to carry the authenticated user
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Middleware: requires a valid Bearer JWT in Authorization header.
 * Returns 401 if missing or invalid.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token); // throws on invalid — caught by Express 5 error handler
  req.user = payload;
  logger.debug(`Authenticated request from user: ${payload.username} (${payload.userId})`);
  next();
}

/**
 * Middleware: optionally loads user if a token is present, but does NOT block.
 * Used for endpoints that work for both guests and authenticated users.
 */
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      req.user = verifyToken(token);
    } catch {
      // Token invalid — fine, just proceed as guest
    }
  }
  next();
}

/**
 * Middleware: requires the authenticated user to have role === 'ADMIN'.
 * Must be used AFTER requireAuth in the middleware chain.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
