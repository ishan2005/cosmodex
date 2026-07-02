import Redis from 'ioredis';
import { logger } from './logger.js';

class InMemoryRedis {
  private store = new Map<string, string>();
  private expiries = new Map<string, number>();

  constructor() {
    logger.warn('Using InMemoryRedis storage for active session caching.');
  }

  async get(key: string): Promise<string | null> {
    this.checkExpiries();
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    this.store.set(key, value);
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key) ? 1 : 0;
    this.store.delete(key);
    this.expiries.delete(key);
    return existed;
  }

  async keys(pattern: string): Promise<string[]> {
    this.checkExpiries();
    const allKeys = Array.from(this.store.keys());
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return allKeys.filter(k => k.startsWith(prefix));
    }
    return allKeys;
  }

  async exists(key: string): Promise<number> {
    this.checkExpiries();
    return this.store.has(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.store.has(key)) {
      this.expiries.set(key, Date.now() + seconds * 1000);
      return 1;
    }
    return 0;
  }

  async ttl(key: string): Promise<number> {
    this.checkExpiries();
    if (!this.store.has(key)) return -2;
    const expiry = this.expiries.get(key);
    if (!expiry) return -1;
    return Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<void> {}
  disconnect(): void {}

  private checkExpiries() {
    const now = Date.now();
    for (const [key, expiry] of this.expiries.entries()) {
      if (now > expiry) {
        this.store.delete(key);
        this.expiries.delete(key);
      }
    }
  }
}

class RedisWrapper {
  private client: any;
  private isFallback = false;
  private ready: Promise<void>;

  constructor() {
    const url = process.env.REDIS_URL;
    // For local prototype and test execution without redis daemon running
    if (url && process.env.NODE_ENV !== 'test-mock') {
      try {
        const clientInstance = new Redis(url, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          lazyConnect: true,             // Don't auto-connect — we'll do it manually
          retryStrategy: () => null,     // Stop retrying on failed connections immediately
        });

        this.client = clientInstance;

        // Attempt to connect and verify within 2 seconds.
        // If it fails, fall back to InMemoryRedis BEFORE any game operations run.
        this.ready = clientInstance.connect()
          .then(() => clientInstance.ping())
          .then(() => {
            logger.info('Redis connection established successfully.');
          })
          .catch((err: Error) => {
            logger.warn(`Redis connection failed: ${err.message}. Switching to InMemory storage.`);
            try { clientInstance.disconnect(); } catch {}
            this.client = new InMemoryRedis();
            this.isFallback = true;
          });

        // Also catch async errors after initial connection (e.g. Redis goes down mid-game)
        clientInstance.on('error', (err) => {
          if (!this.isFallback) {
            logger.warn(`Redis connection lost: ${err.message}. Switching to InMemory storage.`);
            this.client = new InMemoryRedis();
            this.isFallback = true;
          }
        });
      } catch (error) {
        logger.warn(`Failed to initialize ioredis. Falling back to InMemory storage.`);
        this.client = new InMemoryRedis();
        this.isFallback = true;
        this.ready = Promise.resolve();
      }
    } else {
      this.client = new InMemoryRedis();
      this.isFallback = true;
      this.ready = Promise.resolve();
    }
  }

  /** Wait for the initial connection attempt to finish before using the client. */
  async waitForReady(): Promise<void> {
    await this.ready;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<string> {
    return this.client.set(key, value);
  }

  async setex(key: string, seconds: number, value: string): Promise<string> {
    return this.client.setex(key, seconds, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async ping(): Promise<string> {
    if (this.isFallback) return 'PONG'; // InMemoryRedis is always alive
    return this.client.ping();
  }

  async quit(): Promise<void> {
    if (!this.isFallback && this.client.quit) {
      await this.client.quit();
    }
  }

  disconnect(): void {
    if (!this.isFallback && this.client.disconnect) {
      this.client.disconnect();
    }
  }
}

export const redis = new RedisWrapper();
export type RedisClient = RedisWrapper;
