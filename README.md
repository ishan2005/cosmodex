# 🚀 COSMODEX — 1v1 Competitive Coding Arena Backend

> **For Product Managers:** This document is written specifically for you. No deep coding knowledge required. By the end, you will understand *what* this backend does, *why* every design decision was made, and *what business outcomes* it enables.

---

## 📌 Table of Contents

1. [What is COSMODEX?](#-what-is-cosmodex)
2. [The Game — How a Match Works](#-the-game--how-a-match-works)
3. [System Architecture — The Big Picture](#-system-architecture--the-big-picture)
4. [Technology Stack & Why We Chose It](#-technology-stack--why-we-chose-it)
5. [Data Models — What We Store & Why](#-data-models--what-we-store--why)
6. [Real-Time Communication — How Players Feel the Match](#-real-time-communication--how-players-feel-the-match)
7. [Scoring & ELO Ranking System](#-scoring--elo-ranking-system)
8. [Code Execution Engine](#-code-execution-engine)
9. [API Endpoints — What the Frontend Talks To](#-api-endpoints--what-the-frontend-talks-to)
10. [Key Business Rules Encoded in the Backend](#-key-business-rules-encoded-in-the-backend)
11. [Local Development Setup](#-local-development-setup)
12. [Project File Structure](#-project-file-structure)
13. [Open Product Questions & Future Roadmap](#-open-product-questions--future-roadmap)

---

## 🎮 What is COSMODEX?

COSMODEX is a **real-time, competitive coding platform** where two players battle head-to-head solving programming challenges in a timed arena. Think of it like a chess match but for coders — every move matters, every second counts, and there is a boss waiting at the end.

**The core product promise:**
- Two players enter. One wins.
- The match is fair, real-time, and skill-rated.
- The format is designed to be *engaging* (not just a timer + leaderboard).

---

## 🎯 The Game — How a Match Works

A match is divided into **two phases**:

### Phase 1: The Sprint (Stages 1–5)

Each of the 5 stages presents both players with the **same coding problem**. The difficulty escalates from EASY → MEDIUM.

| Stage | Difficulty | Points if Solved | Time Limit |
|-------|-----------|-----------------|------------|
| 1 | EASY | 100 pts | 3 minutes |
| 2 | EASY | 100 pts | 3 minutes |
| 3 | MEDIUM | 150 pts | 3 minutes |
| 4 | MEDIUM | 150 pts | 3 minutes |
| 5 | MEDIUM | 150 pts | 3 minutes |

#### ⚡ The Skip-or-Stay Mechanic (Core Engagement Hook)

When **Player A** finishes a stage first, something exciting happens:

- A **15-second countdown clock** starts for **Player B**
- Player B is given a choice:
  - **🏃 SKIP** — Move on to the next stage immediately. No shame, but **lose 1 life**.
  - **💪 STAY** — Keep coding. If they solve it, they earn the points. But every wrong submission costs **1 life**.
- If Player B doesn't decide within 15 seconds → **Auto-forced to SKIP** (and loses 1 life)

> **Why this matters for the product:** This mechanic creates *drama* and *decision pressure* — the hallmark of great competitive experiences. Players aren't just racing the clock; they're racing each other with real stakes.

#### Lives System

- Every player starts with **5 lives** ❤️❤️❤️❤️❤️
- Lives are lost by:
  - Choosing SKIP (−1 life)
  - Wrong submission while STAYing (−1 life per wrong answer)
  - Failing to complete a stage before the timer runs out (−1 life)
- Running out of lives → **ELIMINATED** from that stage (still moves on to next stage)

---

### Phase 2: Boss Battle (Stage 6)

After the 5 sprints, **both players face the BOSS problem** — a significantly harder algorithmic challenge (e.g. *Longest Palindromic Substring*).

| Rule | Detail |
|------|--------|
| Timer | **20 minutes** |
| Points | **300 pts** |
| Wrong submission | **−1 life** |
| First correct submission | **Instant win** 🏆 |
| Timeout (no one solves it) | **Draw — no winner** |

#### 💎 The Redemption Mechanic (Boss Battle Exclusive)

If a player is **eliminated** (0 lives) during the Boss Battle, they can spend **100 points** to buy back **1 extra life** and keep fighting. This creates a fascinating risk/reward decision:

> *"Do I burn my score lead to get back in the game, or do I accept defeat?"*

---

## 🏗 System Architecture — The Big Picture

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND CLIENT                      │
│              (Web browser / Mobile app)                  │
└──────────────────────┬──────────────────────────────────┘
                       │
            WebSocket (Socket.io) + REST HTTP
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   NODE.JS SERVER                         │
│                                                          │
│  ┌─────────────────┐    ┌──────────────────────────────┐ │
│  │  REST API        │    │   Socket.io Event Engine     │ │
│  │  (Express.js)    │    │   (Real-time match events)   │ │
│  │                  │    │                              │ │
│  │  GET /health     │    │  join_room                   │ │
│  │  GET /api/       │    │  submit_code                 │ │
│  │      problems    │    │  decide_skip_stay            │ │
│  │  GET /api/       │    │  auto_save_draft             │ │
│  │      room/:id    │    │  redeem_life                 │ │
│  │  GET /api/       │    │  (+ background timer tick)   │ │
│  │      users/:id   │    │                              │ │
│  └─────────────────┘    └──────────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │               SERVICE LAYER                          │ │
│  │                                                      │ │
│  │  MatchService     RedisService     ExecutorService   │ │
│  │  (Game logic)     (Cache ops)      (Code runner)     │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┴──────────────┐
         │                            │
┌────────▼────────┐          ┌────────▼────────┐
│     REDIS        │          │     SQLite DB    │
│  (Live match     │          │  (Persistent     │
│   state cache)   │          │   records)       │
│                  │          │                  │
│  Room State      │          │  Users           │
│  Player States   │          │  Problems        │
│  Code Drafts     │          │  Test Cases      │
│  (1-hr TTL)      │          │  Matches         │
│                  │          │  Submissions     │
└─────────────────┘          └─────────────────┘
```

### Why Two Databases?

| | Redis (Cache) | SQLite (Persistent DB) |
|---|---|---|
| **What** | Live match state | Historical records |
| **Speed** | Microseconds | Milliseconds |
| **Data lifetime** | 1 hour (auto-expires) | Forever |
| **Use case** | Every frame of a live match | End-of-match summaries, ELO ratings |
| **Analogy** | RAM in your computer | Hard drive |

> **PM Takeaway:** During a live match, *every player action* (submission, skip/stay choice, timer tick) reads/writes to Redis. SQLite is only touched at the *start* and *end* of a match. This is what makes the game feel instant.

---

## 🔧 Technology Stack & Why We Chose It

| Technology | Role | Why We Chose It |
|---|---|---|
| **Node.js + TypeScript** | Server runtime | Non-blocking I/O is perfect for real-time; TypeScript catches bugs before they reach production |
| **Express.js v5** | REST API framework | Minimal, battle-tested, async-native in v5 |
| **Socket.io v4** | Real-time WebSockets | Handles connection drops gracefully with built-in reconnection; rooms are native |
| **Redis (via ioredis)** | Live state cache | Sub-millisecond reads; TTL auto-cleanup; the industry standard for real-time game state |
| **Prisma ORM** | Database access layer | Type-safe queries; schema-as-code; migration tooling built in |
| **SQLite** | Persistent database | Zero-setup for development; can be swapped for PostgreSQL in production with one config change |
| **Winston** | Structured logging | JSON logs are searchable; different log levels (debug/info/error) for operations |
| **Docker Compose** | Infrastructure management | One command brings up all dependencies (Redis, PostgreSQL) |
| **Zod** | Input validation | Runtime type safety for untrusted client payloads |

---

## 🗄 Data Models — What We Store & Why

### `User`
Represents a registered player account.

| Field | Type | Business Meaning |
|---|---|---|
| `id` | UUID | Unique identifier |
| `username` | String (unique) | Display name in the arena |
| `email` | String (unique) | Account identity |
| `passwordHash` | String | Stored hashed, never plain text |
| `eloRating` | Integer (default: 1000) | **Skill rating** — this is the core matchmaking number |
| `createdAt` | DateTime | Account age |

### `Problem`
A coding challenge stored in the database.

| Field | Type | Business Meaning |
|---|---|---|
| `id` | UUID | Reference used by match rooms |
| `title` | String | Human-readable name |
| `description` | String | The problem statement shown to players |
| `difficulty` | String | `EASY`, `MEDIUM`, `HARD`, `BOSS` |
| `basePoints` | Integer | How many points a correct solution is worth |
| `timeLimitSec` | Integer | Code execution must finish within this many seconds |
| `memoryLimitMb` | Integer | Max memory the code can use |

### `TestCase`
The hidden and public inputs/outputs used to grade submissions.

| Field | Type | Business Meaning |
|---|---|---|
| `input` | String | What gets fed into the player's code |
| `expected` | String | The correct output |
| `isPublic` | Boolean | `true` = shown to player; `false` = hidden grading case |

> **PM Insight:** Public test cases help players debug. Hidden test cases prevent players from hardcoding answers. This is the standard model used by LeetCode, Codeforces, and every serious competitive platform.

### `Match`
The permanent record of a completed game.

| Field | Type | Business Meaning |
|---|---|---|
| `player1Id` / `player2Id` | UUID | Who played |
| `winnerId` | UUID (nullable) | `null` = draw |
| `startedAt` / `endedAt` | DateTime | Match duration tracking |
| `status` | String | `ACTIVE` → `COMPLETED` / `ABANDONED` |
| `player1Score` / `player2Score` | Integer | Final point totals |

### `Submission`
Every code submission a player makes — the full audit trail.

| Field | Business Meaning |
|---|---|
| `code` | The actual code submitted (stored for replay / review) |
| `language` | `PYTHON`, `CPP`, `JAVA` |
| `status` | `ACCEPTED`, `WRONG_ANSWER`, `TIME_LIMIT_EXCEEDED`, `RUNTIME_ERROR` |
| `passedCount` / `totalCount` | e.g. "3/4 test cases passed" |

---

## 📡 Real-Time Communication — How Players Feel the Match

The real-time layer uses **WebSocket "rooms"** (think of a private chat room, but for game state).

### Events the Client SENDS to Server

| Event | Payload | What It Does |
|---|---|---|
| `join_room` | `{ roomId, userId }` | Player enters the arena; receives current match state |
| `submit_code` | `{ roomId, userId, problemId, code, language }` | Triggers code execution and grading |
| `decide_skip_stay` | `{ roomId, userId, choice: 'skip'|'stay' }` | Player responds to the Skip-or-Stay decision window |
| `auto_save_draft` | `{ roomId, userId, code }` | Autosaves code every few seconds to Redis |
| `redeem_life` | `{ roomId, userId }` | Boss Battle only: spends 100 points for 1 life |

### Events the Server SENDS to Clients

| Event | Who Receives It | What It Contains |
|---|---|---|
| `room_state_update` | **Both players** | Complete match state (lives, points, stage, timer, player statuses) |
| `submission_result` | **Only the submitter** | Pass/fail per test case, points awarded, lives remaining |
| `opponent_completed_stage` | **Both players** | Notifies that the first finisher is done; triggers decision timer |
| `match_ended` | **Both players** | Winner ID (or null for draw) |
| `error` | **Only affected client** | Error message if something went wrong |

### The Background Timer

A **server-side ticker** runs every **1 second** and scans all active rooms in Redis. For each active room:
1. Decrements `stageTimeRemaining` by 1
2. If timer hits 0 → triggers `handleStageTimeout()` → advances to next stage
3. Broadcasts the updated state to all players in the room

> **PM Insight:** The timer lives on the *server*, not the client. This is critical for anti-cheat — a player cannot manipulate their local clock to extend time.

---

## 📊 Scoring & ELO Ranking System

### In-Match Points

| Action | Points |
|---|---|
| Correct submission, Stages 1–2 | **+100 pts** |
| Correct submission, Stages 3–5 | **+150 pts** |
| Correct submission, Boss Battle | **+300 pts** |
| Redeem life (Boss only) | **−100 pts** |
| Any wrong/skipped action | **0 pts** |

Maximum possible score (perfect match): `100 + 100 + 150 + 150 + 150 + 300 = 950 pts`

### ELO Rating (Post-Match)

COSMODEX uses the **standard ELO algorithm** (same as chess, used by League of Legends, Lichess, etc.):

- Every player starts at **ELO 1000**
- The expected win probability is calculated based on the gap between ratings
- After a match: winner gains ELO, loser loses ELO
- The **K-factor is 32** (industry standard for new players / moderate volatility)

**Formula:**

```
Expected Score = 1 / (1 + 10^((OpponentElo - YourElo) / 400))
New ELO = Old ELO + 32 × (Actual Result - Expected Score)
```

**Example:**
- Player A (ELO 1200) vs Player B (ELO 1000)
- Player B wins (upset)
- Player B gains ~+26 ELO (more than normal, because they were the underdog)
- Player A loses ~−26 ELO

> **PM Insight:** ELO is the industry's most battle-tested rating system. It self-corrects over time and naturally groups players of similar skill, which is the foundation for **fair matchmaking**.

---

## ⚙️ Code Execution Engine

When a player submits code, it goes through the **Executor Service**:

```
Player Code ──▶ ExecutorService.getExecutor()
                     │
          ┌──────────▼──────────┐
          │  Is JUDGE0_URL set? │
          └──────────┬──────────┘
               No    │   Yes
          ┌────────▼──▼────────┐
          │  LocalPython  │ Judge0 API │
          │  Executor     │ Executor   │
          └───────────────────────────┘
                     │
          Run code against each test case
                     │
          Return: ACCEPTED / WRONG_ANSWER /
                  TIME_LIMIT_EXCEEDED / RUNTIME_ERROR
```

### How LocalPythonExecutor Works
1. Writes the submitted code to a **temporary `.py` file** in `/temp_runs/`
2. Spawns a **sandboxed child process**: `python <file.py>`
3. Feeds test case `input` to the process via `stdin`
4. Compares `stdout` to `expected` output (with a **3-second kill timeout**)
5. **Deletes the temp file** immediately after (no data leaks)
6. Repeats for every test case

### Judge0 Integration (Production-Ready)
The architecture supports plugging in **Judge0** (an open-source sandboxed code execution API) by simply setting the `JUDGE0_URL` environment variable. This enables:
- Multi-language support (C++, Java, Go, etc.)
- Better sandboxing and security
- Scalable execution

> **PM Insight:** The local executor is for development only. In production, all user code should run in an isolated Docker container via Judge0 to prevent any malicious code from affecting the server.

---

## 🌐 API Endpoints — What the Frontend Talks To

The REST API is used for **non-real-time** data fetches (match history, problem lists, user profiles).

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Server heartbeat — used by load balancers to check if the server is alive |
| `GET` | `/api/problems` | Returns all seeded coding problems with their **public** test cases |
| `GET` | `/api/room/:roomId` | Returns the current live state of a match room from Redis cache |
| `GET` | `/api/users/:userId` | Returns a player's profile including their current ELO rating |

---

## 📋 Key Business Rules Encoded in the Backend

These rules are *enforced by the server*, not just the UI. A client cannot bypass them:

| Rule | Where Enforced | Why It Matters |
|---|---|---|
| Skip costs exactly 1 life | `MatchService.handleSkipOrStayDecision` | Prevents free skipping |
| Wrong answer while STAYing costs 1 life | `MatchService.handleWrongSubmissionInStay` | Risk/reward balance |
| Auto-skip after 15s decision window | `match.handler.ts` — `setTimeout` | Prevents game from stalling |
| Life redemption only in Boss Battle | `MatchService.handleRedeemLife` | Keeps mechanic contextually meaningful |
| Boss Battle correct submission = instant win | `MatchService.handleCorrectSubmission` (Phase 2 branch) | Clear, unambiguous win condition |
| Boss Battle timeout = draw (no winner) | `MatchService.handleStageTimeout` (Boss branch) | Edge case handling |
| Timer runs server-side | `sockets/index.ts` background interval | Anti-cheat |
| ELO updates atomically after match | `MatchService.endMatch` | Consistent rating system |
| Redis state deleted after match ends | `RedisService.deleteRoomState` | Memory hygiene, no stale data |
| Code drafts auto-expire after 1 hour | Redis TTL in `RedisService` | Automatic cleanup |

---

## 🛠 Local Development Setup

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Python 3](https://www.python.org/) (for local code execution)

### Step-by-Step

**1. Clone the repository**
```bash
git clone https://github.com/YOUR_USERNAME/cosmodex.git
cd cosmodex
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up environment variables**

Create a `.env` file in the project root (copy from the example below):
```env
DATABASE_URL="file:./prisma/dev.db"
REDIS_URL="redis://localhost:6379"
PORT=3000
# Optional: JUDGE0_URL="http://localhost:2358"
```

**4. Start Redis (via Docker)**
```bash
docker-compose up -d redis
```

**5. Set up the database**
```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed with test data (2 users + 6 problems)
npx tsx prisma/seed.ts
```

**6. Start the development server**
```bash
npx tsx src/server.ts
```

The server will be running at `http://localhost:3000`.

**7. Run the integration test**
```bash
npx tsx scratch/verify_match.ts
```

This runs a **complete simulated match** from start to finish through all 6 stages, verifying the entire game loop works end-to-end.

---

## 📁 Project File Structure

```
cosmodex/
├── prisma/
│   ├── schema.prisma        # Database schema (the source of truth for all data models)
│   └── seed.ts              # Seeds 2 test users + 6 problems into the database
│
├── src/
│   ├── app.ts               # Express app setup + REST API routes
│   ├── server.ts            # App entry point; starts HTTP server
│   │
│   ├── config/
│   │   ├── db.ts            # Prisma client singleton
│   │   ├── redis.ts         # Redis client singleton
│   │   └── logger.ts        # Winston logger configuration
│   │
│   ├── services/
│   │   ├── match.service.ts    # 🎯 CORE: All game logic lives here
│   │   ├── redis.service.ts    # Redis read/write helpers
│   │   └── executor.service.ts # Code execution engine (local Python + Judge0)
│   │
│   ├── sockets/
│   │   ├── index.ts         # Socket.io server setup + background timer
│   │   └── match.handler.ts # WebSocket event handlers (join, submit, skip/stay, etc.)
│   │
│   └── types/
│       └── index.ts         # TypeScript type definitions (RoomState, PlayerState, etc.)
│
├── scratch/
│   └── verify_match.ts      # End-to-end integration test script
│
├── temp_runs/               # Temporary files created during Python code execution (auto-cleaned)
├── docker-compose.yml       # Brings up Redis (and optional PostgreSQL) via Docker
├── package.json             # Node.js dependencies and scripts
├── tsconfig.json            # TypeScript compiler configuration
└── README.md                # You are here!
```

---

## 🔮 Open Product Questions & Future Roadmap

These are areas the backend is *designed to support* but not yet fully built:

### Near-Term (Must-Have for Launch)
- [ ] **Authentication & JWT** — Currently no login system; user IDs are assumed. Need proper auth.
- [ ] **Matchmaking Queue** — Currently rooms are manually created. Need a matchmaking system to pair players by ELO.
- [ ] **Production Database** — Currently uses SQLite (local file). Production needs PostgreSQL (already in `docker-compose.yml`).
- [ ] **Judge0 Sandboxing** — Local Python executor is unsafe for production. Must enable Judge0 for all code execution.
- [ ] **Multi-language Support** — Currently only Python is fully supported for local execution.

### Medium-Term (Engagement & Retention)
- [ ] **Match Replay** — All submissions are stored; a replay viewer would be a high-engagement feature.
- [ ] **Spectator Mode** — Architecture supports it; just needs a "spectate" socket event.
- [ ] **Leaderboards** — ELO data is already stored; just needs an endpoint and UI.
- [ ] **Problem Categories** — Tag problems by topic (Arrays, DP, Graphs) for curated match types.
- [ ] **Season System** — Reset ELO seasonally to drive re-engagement.

### Long-Term (Platform Scale)
- [ ] **Horizontal Scaling** — Redis pub/sub can be used to shard Socket.io across multiple server instances.
- [ ] **AI-Powered Problem Generation** — Use LLMs to dynamically generate problems.
- [ ] **Team Battles** — 2v2 or 3v3 match modes (requires significant game logic changes).

---

## 🧪 The Integration Test — What It Proves

The file `scratch/verify_match.ts` runs a complete end-to-end scenario:

| Step | What Happens | What It Tests |
|---|---|---|
| Setup | Connects 2 socket clients | WebSocket connection |
| Stage 1 | Player A solves correctly | Correct submission → DONE status |
| Stage 1 | Player B gets 15s decision → chooses STAY | Skip/Stay mechanic |
| Stage 1 | Player B submits wrong (−1 life) then correct | Wrong answer penalty while STAYING |
| Stage 2 | Player A solves correctly | Stage progression |
| Stage 2 | Player B gets decision → chooses SKIP (−1 life) | Skip mechanic |
| Stages 3-5 | Simulated timeout | `handleStageTimeout` logic |
| Boss Battle | Player A submits wrong twice, gets ELIMINATED | Boss wrong answer penalty |
| Boss Battle | Player A redeems life with 100 pts | `redeem_life` mechanic |
| Boss Battle | Player B submits correct → **WINS** | Instant win condition |
| End | Database checked for correct winner + ELO change | Persistence layer validation |

> After the test runs successfully, you'll see logs confirming Match DB status is `COMPLETED`, the winner is recorded correctly, and ELO ratings have been updated — the entire game loop verified in one automated run.

---

*Built with ❤️ for competitive coders.*
