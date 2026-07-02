import jwt from 'jsonwebtoken';
import { logger } from './logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'cosmodex-dev-secret-change-in-prod';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Signs a JWT token for a given user.
 */
export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * Verifies and decodes a JWT token.
 * Throws JsonWebTokenError if invalid or expired.
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

/**
 * Safely decode a token without throwing (returns null on failure).
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return verifyToken(token);
  } catch (err) {
    logger.warn(`Token decode failed: ${err}`);
    return null;
  }
}
