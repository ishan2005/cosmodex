# COSMODEX — Real-time 1v1 Coding Battle Backend

A production-grade Node.js backend for a competitive coding platform.  
Two players face off through **5 Sprint stages** + **1 Boss Battle** in real-time.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ + TypeScript 6 |
| HTTP Framework | Express 5 (async-native) |
| Real-time | Socket.IO 4 (WebSocket) |
| ORM | Prisma 6 |
| Database | SQLite (dev) / PostgreSQL (prod via Docker) |
| Cache | Redis (with InMemory auto-fallback) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Validation | Zod 4 |
| Logging | Winston |
| Code Judge | Local Python executor (child_process) |
| Rate Limiting | express-rate-limit |

---

## Quick Start

```bash
# 1. Install all dependencies
npm install

# 2. One-command setup (generates Prisma client, runs migrations, seeds DB)
npm run setup

# 3. Start the server
npm start

# OR in watch mode (auto-restarts on file change)
npm run dev
```

Server runs at: **http://localhost:3000**

---

## Environment Variables (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite path (or PostgreSQL URL in prod) |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL (auto-fallback to InMemory if down) |
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment |
| `JWT_SECRET` | `cosmodex-super-secret-key-change-in-prod` | **Change in production!** |
| `JWT_EXPIRES_IN` | `24h` | JWT token lifetime |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin |

---

## REST API Reference

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Server + DB + Cache status |

**Response:**
```json
{
  "status": "OK",
  "uptime": 142,
  "timestamp": "2026-06-12T12:00:00.000Z",
  "version": "1.0.0",
  "services": { "database": "UP", "cache": "UP" }
}
```

---

### Auth (`/api/auth`)
Rate-limited: 20 requests / 15 minutes per IP

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account → returns JWT |
| POST | `/api/auth/login` | No | Login → returns JWT |
| POST | `/api/auth/logout` | No | Client-side logout hint |

**Register body:** `{ username, email, password }` (password min 6 chars)  
**Login body:** `{ email, password }`

---

### Users (`/api/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | No | Leaderboard (top 50 by ELO) |
| GET | `/api/users/:userId` | No | User profile |
| GET | `/api/users/:userId/stats` | No | Win rate, submission stats |
| GET | `/api/users/:userId/matches` | No | Paginated match history |
| GET | `/api/users/:userId/submissions` | No | Paginated submission history |
| PATCH | `/api/users/me` | **JWT** | Update your username |

Query params for paginated endpoints: `?page=1&limit=10`

---

### Problems (`/api/problems`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/problems` | No | List all problems (public test cases) |
| GET | `/api/problems?difficulty=EASY` | No | Filter by difficulty |
| GET | `/api/problems/:problemId` | No | Single problem detail |
| GET | `/api/problems/:problemId/submissions` | **JWT** | Your submissions for a problem |

---

### Rooms (`/api/room`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/room/:roomId` | No | Live room state from Redis |
| POST | `/api/room` | No | Create a match room manually |
| DELETE | `/api/room/:roomId` | No | Force-close a room |
| GET | `/api/queue` | No | Matchmaking queue status |

**POST /api/room body:** `{ player1Id, player2Id, problemIds[] }`

---

## WebSocket Events (Socket.IO)

Connect: `io('http://localhost:3000', { auth: { token: '<JWT>' } })`  
Token is optional — works without auth in demo mode.

### Match Events

| Client → Server | Payload | Description |
|----------------|---------|-------------|
| `join_room` | `{ roomId, userId }` | Join a match room |
| `submit_code` | `{ roomId, userId, problemId, code, language }` | Submit code for judging |
| `decide_skip_stay` | `{ roomId, userId, choice: 'skip'|'stay' }` | Respond to opponent finishing |
| `auto_save_draft` | `{ roomId, userId, code }` | Autosave editor content |
| `redeem_life` | `{ roomId, userId }` | Spend 100 pts for +1 life (Boss only) |

| Server → Client | Payload | Description |
|----------------|---------|-------------|
| `room_state_update` | `RoomState` | Full game state (every 1 second) |
| `submission_result` | `{ status, passedCount, totalCount, testCases, pointsAwarded, livesRemaining }` | Judge verdict |
| `opponent_completed_stage` | `{ opponentId, decisionTimeRemaining }` | 15s decision window starts |
| `match_ended` | `{ winnerId, reason? }` | Game over |
| `error` | `{ message }` | Server-side error |

### Matchmaking Events

| Client → Server | Payload | Description |
|----------------|---------|-------------|
| `join_queue` | `{ userId }` | Enter the matchmaking queue |
| `leave_queue` | `{ userId }` | Leave the queue |
| `queue_status` | `{}` | Ask for current queue size |

| Server → Client | Payload | Description |
|----------------|---------|-------------|
| `queue_joined` | `{ position, size, message }` | Confirmed in queue |
| `queue_left` | `{ message }` | Confirmed out |
| `match_found` | `{ roomId, opponentId, opponentUsername, opponentElo }` | Opponent found! |
| `queue_pulse` | `{ size, avgWaitSeconds }` | Broadcast every 5s when queue has players |

---

## Game Flow

```
Stage 1 (EASY,  100pts, 3min)
Stage 2 (EASY,  100pts, 3min)
Stage 3 (MEDIUM,150pts, 3min)
Stage 4 (MEDIUM,150pts, 3min)
Stage 5 (MEDIUM,150pts, 3min)
       ↓
Stage 6 — BOSS BATTLE (300pts, 20min)
       ↓
ELO Updated (K=32 formula) + Match saved to DB
```

### Sprint Phase (Stages 1–5)
- First player to submit correctly puts opponent in **SKIP or STAY** (15-second window)
- **SKIP** → –1 life, advance to next stage
- **STAY** → keep coding; each wrong answer costs a life
- Timer expires → unfinished players lose 1 life, stage force-advances
- 0 lives → **ELIMINATED** for rest of match

### Boss Battle (Stage 6)
- First correct submission = **instant win**
- Wrong answer → –1 life
- Spend **100 points → +1 life** (life redemption mechanic)
- Timer expires → draw, both players save ELO

---

## Database Schema

```
User          — id, username, email, passwordHash, eloRating
Problem       — id, title, description, difficulty, basePoints, timeLimitSec
TestCase      — id, problemId, input, expected, isPublic
Match         — id, player1Id, player2Id, winnerId, status, scores, timestamps
Submission    — id, userId, problemId, code, language, status, passedCount
```

---

## Production Deployment

```bash
# Spin up PostgreSQL + Redis with Docker
docker-compose up -d

# Update DATABASE_URL in .env to:
# DATABASE_URL="postgresql://cosmodex_user:cosmodex_password@localhost:5432/cosmodex_db"

# Run setup
npm run setup

# Start
npm start
```

---

## Architecture

```
Client (Browser)
  │
  ├── HTTP REST ──→ Express API ──→ Prisma ──→ SQLite / PostgreSQL
  │
  └── WebSocket ──→ Socket.IO ──→ MatchService    ──→ Redis / InMemory
                                 MatchmakingService
                                 ExecutorService ──→ Python Runtime
```
