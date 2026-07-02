# COSMODEX Battle Arena — API Documentation

> **Base URL (local):** `http://localhost:3000`
> **Base URL (deployed):** `https://cosmodex-battle-server.onrender.com`
> **WebSocket URL:** Same as base URL (Socket.IO auto-negotiates)

Complete integration guide for the frontend team. This document covers every REST endpoint, every WebSocket event, authentication flows, and game lifecycle.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [REST API Reference](#2-rest-api-reference)
   - [Health](#health)
   - [Auth](#auth)
   - [Users](#users)
   - [Problems](#problems)
   - [Matches](#matches)
   - [Rooms](#rooms)
   - [Queue](#queue)
   - [Admin](#admin)
3. [WebSocket Events](#3-websocket-events)
   - [Connection Setup](#connection-setup)
   - [Matchmaking Events](#matchmaking-events)
   - [Match Events](#match-events)
4. [TypeScript Interfaces](#4-typescript-interfaces)
5. [Integration Guides](#5-integration-guides)
   - [Authentication Flow](#authentication-flow)
   - [Matchmaking Flow](#matchmaking-flow)
   - [Match Lifecycle](#match-lifecycle)
   - [Game Rules Summary](#game-rules-summary)
6. [Error Handling](#6-error-handling)

---

## 1. Authentication

All protected endpoints require a **Bearer JWT token** in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**How to get a token:**
1. Register (`POST /api/auth/register`) or Login (`POST /api/auth/login`)
2. The response includes a `token` field
3. Use that token in all subsequent requests

**Token lifetime:** 24 hours (configurable via `JWT_EXPIRES_IN` env var)

**JWT Payload structure:**
```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "username": "cosmo_coder",
  "role": "USER",
  "iat": 1719792000,
  "exp": 1719878400
}
```

---

## 2. REST API Reference

### Health

#### `GET /health`

Check server, database, and cache status. No auth required.

**Sample Request:**
```bash
curl http://localhost:3000/health
```

**Sample Response (200 OK):**
```json
{
  "status": "OK",
  "uptime": 3421,
  "timestamp": "2026-07-01T12:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": "UP",
    "cache": "UP"
  }
}
```

**Degraded Response (503):**
```json
{
  "status": "DEGRADED",
  "uptime": 3421,
  "timestamp": "2026-07-01T12:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": "UP",
    "cache": "DOWN"
  }
}
```

---

### Auth

> **Rate limit:** 20 requests per 15 minutes per IP

---

#### `POST /api/auth/register`

Create a new user account and receive a JWT.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `username` | string | ✅ | Must be unique |
| `email` | string | ✅ | Must be unique |
| `password` | string | ✅ | Min 6 characters |

**Sample Request:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "cosmo_coder",
    "email": "cosmo@example.com",
    "password": "securePass123"
  }'
```

**Sample Response (201 Created):**
```json
{
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "cosmo_coder",
    "email": "cosmo@example.com",
    "eloRating": 1000,
    "role": "USER",
    "createdAt": "2026-07-01T12:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhMWIyYzNkNC1lNWY2LTc4OTAtYWJjZC1lZjEyMzQ1Njc4OTAiLCJ1c2VybmFtZSI6ImNvc21vX2NvZGVyIiwicm9sZSI6IlVTRVIiLCJpYXQiOjE3MTk3OTIwMDAsImV4cCI6MTcxOTg3ODQwMH0.example"
}
```

**Error Responses:**

| Status | Body | When |
|--------|------|------|
| 400 | `{ "error": "username, email, and password are required" }` | Missing fields |
| 400 | `{ "error": "Password must be at least 6 characters" }` | Short password |
| 409 | `{ "error": "Username is already taken" }` | Duplicate username |
| 409 | `{ "error": "Email is already taken" }` | Duplicate email |

---

#### `POST /api/auth/login`

Authenticate and receive a JWT.

| Field | Type | Required |
|-------|------|----------|
| `email` | string | ✅ |
| `password` | string | ✅ |

**Sample Request:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "cosmo@example.com",
    "password": "securePass123"
  }'
```

**Sample Response (200 OK):**
```json
{
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "cosmo_coder",
    "email": "cosmo@example.com",
    "eloRating": 1050,
    "role": "USER"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Error Responses:**

| Status | Body | When |
|--------|------|------|
| 400 | `{ "error": "email and password are required" }` | Missing fields |
| 401 | `{ "error": "Invalid email or password" }` | Wrong credentials |

---

#### `POST /api/auth/logout`

Client-side logout hint. The server is stateless (JWT-based), so the client should simply discard the token.

**Sample Request:**
```bash
curl -X POST http://localhost:3000/api/auth/logout
```

**Sample Response (200 OK):**
```json
{
  "message": "Logged out. Please discard your token on the client."
}
```

---

### Users

---

#### `GET /api/users/me` 🔒

Get the authenticated user's full profile with stats. **Requires Bearer token.**

**Sample Request:**
```bash
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

**Sample Response (200 OK):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "username": "cosmo_coder",
  "email": "cosmo@example.com",
  "eloRating": 1050,
  "role": "USER",
  "createdAt": "2026-07-01T12:00:00.000Z",
  "wins": 7,
  "losses": 3,
  "totalMatches": 10,
  "totalSubmissions": 42,
  "acceptedSubmissions": 28,
  "winRate": "70.0%",
  "acceptanceRate": "66.7%"
}
```

| Status | Body | When |
|--------|------|------|
| 401 | `{ "error": "Authentication required. Provide a Bearer token." }` | Missing/invalid token |

---

#### `GET /api/users`

Public leaderboard — top 50 players sorted by ELO rating (descending).

**Sample Request:**
```bash
curl http://localhost:3000/api/users
```

**Sample Response (200 OK):**
```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "cosmo_coder",
    "eloRating": 1250,
    "createdAt": "2026-06-15T08:30:00.000Z"
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "username": "astro_dev",
    "eloRating": 1180,
    "createdAt": "2026-06-20T14:00:00.000Z"
  }
]
```

---

#### `GET /api/users/:userId`

Get a specific user's public profile.

**Sample Request:**
```bash
curl http://localhost:3000/api/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Sample Response (200 OK):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "username": "cosmo_coder",
  "email": "cosmo@example.com",
  "eloRating": 1250,
  "createdAt": "2026-06-15T08:30:00.000Z"
}
```

| Status | Body | When |
|--------|------|------|
| 404 | `{ "error": "User not found" }` | Invalid userId |

---

#### `GET /api/users/:userId/stats`

Get win/loss count, win rate, submission stats for a user.

**Sample Request:**
```bash
curl http://localhost:3000/api/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890/stats
```

**Sample Response (200 OK):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "username": "cosmo_coder",
  "eloRating": 1250,
  "wins": 7,
  "losses": 3,
  "totalMatches": 10,
  "totalSubmissions": 42,
  "acceptedSubmissions": 28,
  "winRate": "70.0%",
  "acceptanceRate": "66.7%"
}
```

---

#### `GET /api/users/:userId/matches`

Paginated match history for a user.

| Query Param | Type | Default | Max |
|-------------|------|---------|-----|
| `page` | number | 1 | — |
| `limit` | number | 10 | 50 |

**Sample Request:**
```bash
curl "http://localhost:3000/api/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890/matches?page=1&limit=5"
```

**Sample Response (200 OK):**
```json
{
  "matches": [
    {
      "id": "m1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "player1Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "player2Id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "winnerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "startedAt": "2026-07-01T10:00:00.000Z",
      "endedAt": "2026-07-01T10:35:00.000Z",
      "status": "COMPLETED",
      "player1Score": 550,
      "player2Score": 300,
      "player1": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "username": "cosmo_coder",
        "eloRating": 1250
      },
      "player2": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "username": "astro_dev",
        "eloRating": 1180
      },
      "winner": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "username": "cosmo_coder"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 10,
    "totalPages": 2,
    "hasNext": true
  }
}
```

---

#### `GET /api/users/:userId/submissions`

Paginated submission history for a user.

| Query Param | Type | Default | Max |
|-------------|------|---------|-----|
| `page` | number | 1 | — |
| `limit` | number | 10 | 50 |

**Sample Request:**
```bash
curl "http://localhost:3000/api/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890/submissions?page=1&limit=5"
```

**Sample Response (200 OK):**
```json
{
  "submissions": [
    {
      "id": "s1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "problemId": "p1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "matchId": "m1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "code": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
      "language": "PYTHON",
      "status": "ACCEPTED",
      "passedCount": 5,
      "totalCount": 5,
      "createdAt": "2026-07-01T10:05:30.000Z",
      "problem": {
        "id": "p1a2b3c4-d5e6-7890-abcd-ef1234567890",
        "title": "Two Sum",
        "difficulty": "EASY"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 42,
    "totalPages": 9,
    "hasNext": true
  }
}
```

---

#### `PATCH /api/users/me` 🔒

Update the authenticated user's username. **Requires Bearer token.**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `username` | string | ✅ | Min 3 characters, must be unique |

**Sample Request:**
```bash
curl -X PATCH http://localhost:3000/api/users/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{ "username": "nova_coder" }'
```

**Sample Response (200 OK):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "username": "nova_coder",
  "email": "cosmo@example.com",
  "eloRating": 1250
}
```

---

### Problems

---

#### `GET /api/problems`

List all coding problems with public test cases only. Optionally filter by difficulty.

| Query Param | Type | Values |
|-------------|------|--------|
| `difficulty` | string | `EASY`, `MEDIUM`, `HARD`, `BOSS` |

**Sample Request:**
```bash
curl http://localhost:3000/api/problems
curl "http://localhost:3000/api/problems?difficulty=EASY"
```

**Sample Response (200 OK):**
```json
[
  {
    "id": "p1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "title": "Two Sum",
    "description": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.",
    "difficulty": "EASY",
    "basePoints": 100,
    "timeLimitSec": 2,
    "memoryLimitMb": 128,
    "testCases": [
      {
        "id": "tc1-uuid",
        "input": "4\n2 7 11 15\n9",
        "expected": "0 1",
        "isPublic": true
      }
    ]
  },
  {
    "id": "p2a2b3c4-d5e6-7890-abcd-ef1234567890",
    "title": "Reverse String",
    "description": "Write a function that reverses a string. The input string is given as an array of characters.",
    "difficulty": "EASY",
    "basePoints": 100,
    "timeLimitSec": 2,
    "memoryLimitMb": 128,
    "testCases": [
      {
        "id": "tc2-uuid",
        "input": "hello",
        "expected": "olleh",
        "isPublic": true
      }
    ]
  }
]
```

> **Note:** Private test cases are NEVER exposed via this endpoint. They are used server-side for judging.

---

#### `GET /api/problems/:problemId`

Get a single problem with its public test cases.

**Sample Request:**
```bash
curl http://localhost:3000/api/problems/p1a2b3c4-d5e6-7890-abcd-ef1234567890
```

**Sample Response (200 OK):**
```json
{
  "id": "p1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "title": "Two Sum",
  "description": "Given an array of integers nums and an integer target...",
  "difficulty": "EASY",
  "basePoints": 100,
  "timeLimitSec": 2,
  "memoryLimitMb": 128,
  "testCases": [
    {
      "id": "tc1-uuid",
      "input": "4\n2 7 11 15\n9",
      "expected": "0 1",
      "isPublic": true
    }
  ]
}
```

---

#### `GET /api/problems/:problemId/submissions` 🔒

Get the authenticated user's submissions for a specific problem. **Requires Bearer token.**

**Sample Request:**
```bash
curl http://localhost:3000/api/problems/p1a2b3c4-d5e6-7890-abcd-ef1234567890/submissions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

**Sample Response (200 OK):**
```json
[
  {
    "id": "s1-uuid",
    "status": "ACCEPTED",
    "language": "PYTHON",
    "passedCount": 5,
    "totalCount": 5,
    "createdAt": "2026-07-01T10:05:30.000Z"
  },
  {
    "id": "s2-uuid",
    "status": "WRONG_ANSWER",
    "language": "PYTHON",
    "passedCount": 3,
    "totalCount": 5,
    "createdAt": "2026-07-01T10:03:15.000Z"
  }
]
```

---

### Matches

---

#### `GET /api/matches`

List recent matches (global match feed). Public endpoint.

| Query Param | Type | Default | Notes |
|-------------|------|---------|-------|
| `page` | number | 1 | — |
| `limit` | number | 10 | Max 50 |
| `status` | string | — | Filter: `ACTIVE`, `COMPLETED`, `ABANDONED` |

**Sample Request:**
```bash
curl "http://localhost:3000/api/matches?status=COMPLETED&page=1&limit=5"
```

**Sample Response (200 OK):**
```json
{
  "matches": [
    {
      "id": "m1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "player1Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "player2Id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "winnerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "startedAt": "2026-07-01T10:00:00.000Z",
      "endedAt": "2026-07-01T10:35:00.000Z",
      "status": "COMPLETED",
      "player1Score": 550,
      "player2Score": 300,
      "player1": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "username": "cosmo_coder",
        "eloRating": 1250
      },
      "player2": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "username": "astro_dev",
        "eloRating": 1180
      },
      "winner": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "username": "cosmo_coder"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 23,
    "totalPages": 5,
    "hasNext": true
  }
}
```

---

#### `GET /api/matches/:matchId`

Fetch a single match with full details including all submissions.

**Sample Request:**
```bash
curl http://localhost:3000/api/matches/m1a2b3c4-d5e6-7890-abcd-ef1234567890
```

**Sample Response (200 OK):**
```json
{
  "id": "m1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "player1Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "player2Id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "winnerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "startedAt": "2026-07-01T10:00:00.000Z",
  "endedAt": "2026-07-01T10:35:00.000Z",
  "status": "COMPLETED",
  "player1Score": 550,
  "player2Score": 300,
  "player1": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "cosmo_coder",
    "eloRating": 1250
  },
  "player2": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "username": "astro_dev",
    "eloRating": 1180
  },
  "winner": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "username": "cosmo_coder"
  },
  "submissions": [
    {
      "id": "s1-uuid",
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "problemId": "p1-uuid",
      "language": "PYTHON",
      "status": "ACCEPTED",
      "passedCount": 5,
      "totalCount": 5,
      "createdAt": "2026-07-01T10:05:30.000Z"
    },
    {
      "id": "s2-uuid",
      "userId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "problemId": "p1-uuid",
      "language": "JAVASCRIPT",
      "status": "WRONG_ANSWER",
      "passedCount": 3,
      "totalCount": 5,
      "createdAt": "2026-07-01T10:06:00.000Z"
    }
  ]
}
```

---

#### `GET /api/matches/:matchId/submissions` 🔒

Fetch all submissions for a match. Only match participants can see the `code` field. **Requires Bearer token.**

**Sample Request:**
```bash
curl http://localhost:3000/api/matches/m1a2b3c4-d5e6-7890-abcd-ef1234567890/submissions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

**Sample Response (200 OK):**
```json
[
  {
    "id": "s1-uuid",
    "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "problemId": "p1-uuid",
    "code": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
    "language": "PYTHON",
    "status": "ACCEPTED",
    "passedCount": 5,
    "totalCount": 5,
    "createdAt": "2026-07-01T10:05:30.000Z",
    "user": { "id": "a1b2c3d4-...", "username": "cosmo_coder" },
    "problem": { "id": "p1-uuid", "title": "Two Sum", "difficulty": "EASY" }
  }
]
```

---

### Rooms

> Rooms are live match sessions stored in Redis. They are temporary and auto-expire after 1 hour.

---

#### `GET /api/room/:roomId`

Fetch the live room state from Redis cache. Returns the full `RoomState` object.

**Sample Request:**
```bash
curl http://localhost:3000/api/room/room-f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Sample Response (200 OK):**
See the [RoomState TypeScript interface](#roomstate) for the full shape.

```json
{
  "matchId": "m1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "roomId": "room-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "ACTIVE",
  "currentStage": 2,
  "stageTimeRemaining": 145,
  "stageEndTime": 1719828145000,
  "playerIds": [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  ],
  "problems": ["p1-uuid", "p2-uuid", "p3-uuid", "p4-uuid", "p5-uuid", "p6-uuid"],
  "players": {
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "username": "cosmo_coder",
      "lives": 5,
      "points": 100,
      "status": "CODING",
      "currentDraft": "def solve():\n    pass",
      "submissionsCount": 2,
      "stageScores": { "1": 100 },
      "decisionTimeout": null,
      "currentStage": 2,
      "stageStartTime": 1719827965000,
      "stageDuration": 180,
      "stageTimeRemaining": 145
    },
    "b2c3d4e5-f6a7-8901-bcde-f12345678901": {
      "userId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "username": "astro_dev",
      "lives": 4,
      "points": 0,
      "status": "CODING",
      "currentDraft": "",
      "submissionsCount": 1,
      "stageScores": {},
      "decisionTimeout": null,
      "currentStage": 2,
      "stageStartTime": 1719827965000,
      "stageDuration": 180,
      "stageTimeRemaining": 145
    }
  }
}
```

---

#### `POST /api/room`

Create a new match room manually (for testing/demo purposes).

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `player1Id` | string (UUID) | ✅ | Must exist in DB |
| `player2Id` | string (UUID) | ✅ | Must be different from player1Id |
| `problemIds` | string[] | ✅ | Array of 6 problem UUIDs |

**Sample Request:**
```bash
curl -X POST http://localhost:3000/api/room \
  -H "Content-Type: application/json" \
  -d '{
    "player1Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "player2Id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "problemIds": ["p1-uuid", "p2-uuid", "p3-uuid", "p4-uuid", "p5-uuid", "p6-uuid"]
  }'
```

**Sample Response (201 Created):** Returns the full `RoomState` object (same shape as GET /api/room/:roomId).

---

#### `DELETE /api/room/:roomId`

Force-close a room (admin/testing use).

**Sample Request:**
```bash
curl -X DELETE http://localhost:3000/api/room/room-f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Sample Response (200 OK):**
```json
{
  "message": "Room room-f47ac10b-58cc-4372-a567-0e02b2c3d479 closed"
}
```

---

### Queue

---

#### `GET /api/queue`

Get the current matchmaking queue status.

**Sample Request:**
```bash
curl http://localhost:3000/api/queue
```

**Sample Response (200 OK):**
```json
{
  "size": 3,
  "avgWaitSeconds": 12
}
```

---

### Admin

> ⚠️ All admin endpoints require `Authorization: Bearer <token>` where the user has `role: "ADMIN"`.

---

#### `GET /api/admin/stats` 🔒👑

Dashboard statistics.

**Sample Response (200 OK):**
```json
{
  "problems": {
    "total": 12,
    "easy": 4,
    "medium": 3,
    "hard": 3,
    "boss": 2
  },
  "users": 150,
  "matches": 89
}
```

---

#### `GET /api/admin/problems` 🔒👑

List all problems **including private test cases**.

---

#### `POST /api/admin/problems` 🔒👑

Create a new problem with test cases.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | ✅ | |
| `description` | string | ✅ | |
| `difficulty` | string | ✅ | `EASY`, `MEDIUM`, `HARD`, `BOSS` |
| `basePoints` | number | ✅ | |
| `timeLimitSec` | number | ❌ | Default: 2 |
| `memoryLimitMb` | number | ❌ | Default: 128 |
| `testCases` | array | ❌ | `[{ input, expected, isPublic? }]` |

**Sample Request:**
```bash
curl -X POST http://localhost:3000/api/admin/problems \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fibonacci Sequence",
    "description": "Given n, return the nth Fibonacci number.",
    "difficulty": "EASY",
    "basePoints": 100,
    "timeLimitSec": 2,
    "testCases": [
      { "input": "5", "expected": "5", "isPublic": true },
      { "input": "10", "expected": "55", "isPublic": false },
      { "input": "0", "expected": "0", "isPublic": false }
    ]
  }'
```

---

#### `PUT /api/admin/problems/:id` 🔒👑

Update a problem's fields (does NOT change test cases).

#### `DELETE /api/admin/problems/:id` 🔒👑

Delete a problem and all its test cases (cascade).

#### `POST /api/admin/problems/:id/test-cases` 🔒👑

Add a test case to an existing problem.

#### `DELETE /api/admin/test-cases/:id` 🔒👑

Delete a single test case.

#### `GET /api/admin/users` 🔒👑

List all users with roles.

#### `PATCH /api/admin/users/:userId/role` 🔒👑

Change a user's role. Body: `{ "role": "ADMIN" | "USER" }`

---

## 3. WebSocket Events

### Connection Setup

```javascript
import { io } from "socket.io-client";

// Connect WITH authentication (recommended)
const socket = io("http://localhost:3000", {
  auth: {
    token: "eyJhbGciOiJIUzI1NiIs..." // JWT from login/register
  }
});

// Connect WITHOUT auth (works for demo/testing)
const socket = io("http://localhost:3000");

// Connection events
socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});

socket.on("error", (data) => {
  console.error("Server error:", data.message);
});
```

---

### Matchmaking Events

#### `join_queue` (Client → Server)

Add the player to the matchmaking queue. The server will find an ELO-matched opponent.

```javascript
socket.emit("join_queue", { userId: "a1b2c3d4-..." });
```

**Server responses:**

If queued (no opponent available yet):
```javascript
// Event: queue_joined
socket.on("queue_joined", (data) => {
  console.log(data);
  // {
  //   position: 1,
  //   size: 1,
  //   message: "Searching for an opponent near ELO 1050..."
  // }
});
```

If an opponent is found immediately:
```javascript
// Event: match_found
socket.on("match_found", (data) => {
  console.log(data);
  // {
  //   roomId: "room-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  //   opponentId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  //   opponentUsername: "astro_dev",
  //   opponentElo: 1080
  // }
  
  // Next step: join the room!
  socket.emit("join_room", { roomId: data.roomId, userId: myUserId });
});
```

---

#### `leave_queue` (Client → Server)

Remove the player from the queue.

```javascript
socket.emit("leave_queue", { userId: "a1b2c3d4-..." });
```

**Response:**
```javascript
socket.on("queue_left", (data) => {
  // { message: "Left the matchmaking queue" }
});
```

---

#### `queue_status` (Client → Server)

Ask for the current queue size.

```javascript
socket.emit("queue_status");
```

**Response:**
```javascript
socket.on("queue_status", (data) => {
  // { size: 3, avgWaitSeconds: 12 }
});
```

---

#### `queue_pulse` (Server → Client, broadcast)

Broadcasted to ALL connected clients every 5 seconds when the queue has players.

```javascript
socket.on("queue_pulse", (data) => {
  // { size: 5, avgWaitSeconds: 8 }
  // Use this to show "5 players searching" in the lobby UI
});
```

---

### Match Events

#### `join_room` (Client → Server)

Join a match room after receiving `match_found`. Both players must join.

```javascript
socket.emit("join_room", {
  roomId: "room-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
});
```

**Response:** `room_state_update` is emitted to ALL players in the room.

---

#### `room_state_update` (Server → Client)

**This is the primary game state event.** Emitted every 1 second with the full `RoomState` object. Use this to render the entire game UI.

```javascript
socket.on("room_state_update", (roomState) => {
  // roomState is the full RoomState object (see TypeScript interfaces)
  // Update your UI based on:
  //   - roomState.currentStage (1-6)
  //   - roomState.players[myUserId].stageTimeRemaining
  //   - roomState.players[myUserId].lives
  //   - roomState.players[myUserId].points
  //   - roomState.players[myUserId].status
  //   - roomState.problems[roomState.currentStage - 1] → current problem ID
});
```

---

#### `submit_code` (Client → Server)

Submit code for judging against the current problem's test cases.

```javascript
socket.emit("submit_code", {
  roomId: "room-f47ac10b-...",
  userId: "a1b2c3d4-...",
  problemId: "p1a2b3c4-...",  // Get from roomState.problems[stage - 1]
  code: "def two_sum(nums, target):\n    seen = {}\n    ...",
  language: "python"           // "python", "javascript", "cpp"
});
```

**Response:**
```javascript
socket.on("submission_result", (result) => {
  console.log(result);
  // {
  //   status: "ACCEPTED",          // or "WRONG_ANSWER", "RUNTIME_ERROR", "TIME_LIMIT_EXCEEDED"
  //   passedCount: 5,
  //   totalCount: 5,
  //   testCases: [                  // Only PUBLIC test cases are shown
  //     {
  //       passed: true,
  //       input: "4\n2 7 11 15\n9",
  //       expected: "0 1",
  //       actual: "0 1",
  //       isPublic: true
  //     }
  //   ],
  //   pointsAwarded: 100,          // 0 if not ACCEPTED
  //   livesRemaining: 5
  // }
});
```

---

#### `opponent_completed_stage` (Server → Client)

Sent to the LOSING player when the opponent solves a sprint stage first. The player has 15 seconds to decide: **Skip** or **Stay**.

```javascript
socket.on("opponent_completed_stage", (data) => {
  console.log(data);
  // {
  //   opponentId: "a1b2c3d4-...",
  //   decisionTimeRemaining: 15       // seconds
  // }
  
  // Show the Skip/Stay modal to the user
  // They must respond within 15 seconds or auto-skip
});
```

---

#### `waiting_for_opponent` (Server → Client)

Sent to the WINNING player after they complete a stage. Shows "waiting for opponent to decide..."

```javascript
socket.on("waiting_for_opponent", (data) => {
  // {
  //   message: "Opponent is deciding whether to skip or stay…",
  //   decisionTimeRemaining: 15
  // }
  
  // Show a waiting overlay to the winner
});
```

---

#### `decide_skip_stay` (Client → Server)

Player B's response to the Skip/Stay decision.

```javascript
// SKIP — lose 1 life, both advance to next stage
socket.emit("decide_skip_stay", {
  roomId: "room-f47ac10b-...",
  userId: "b2c3d4e5-...",
  choice: "skip"
});

// STAY — keep coding the same problem. Wrong answers cost 1 life each.
socket.emit("decide_skip_stay", {
  roomId: "room-f47ac10b-...",
  userId: "b2c3d4e5-...",
  choice: "stay"
});
```

**Response:** `room_state_update` + `stage_advanced` emitted to both players.

```javascript
socket.on("stage_advanced", (data) => {
  // { stage: 3, reason: "opponent_skipped" | "opponent_stayed" | "opponent_timed_out" }
});
```

---

#### `auto_save_draft` (Client → Server)

Autosave the player's code editor content. Call this periodically (e.g., every 5 seconds) or on blur.

```javascript
socket.emit("auto_save_draft", {
  roomId: "room-f47ac10b-...",
  userId: "a1b2c3d4-...",
  code: "def solve():\n    # work in progress..."
});
```

No response event — this is fire-and-forget. Draft is restored when the player joins the room.

---

#### `redeem_life` (Client → Server)

Spend 100 points to gain +1 life. **Only available during Boss Battle (Stage 6).**

```javascript
socket.emit("redeem_life", {
  roomId: "room-f47ac10b-...",
  userId: "a1b2c3d4-..."
});
```

**Response:** `room_state_update` with updated lives/points, OR:
```javascript
socket.on("error", (data) => {
  // { message: "Need at least 100 points to redeem a life (you have 50)" }
  // { message: "Life redemption is only available in the Boss Battle" }
});
```

---

#### `run_code` (Client → Server)

Run code with custom stdin — no test cases, no match state changes. Used by the "Run" button in the editor.

```javascript
socket.emit("run_code", {
  code: "print(input())",
  language: "python",
  stdin: "Hello World"
});
```

**Response:**
```javascript
socket.on("run_result", (data) => {
  // {
  //   stdout: "Hello World\n",
  //   stderr: "",
  //   timedOut: false
  // }
});
```

---

#### `match_ended` (Server → Client)

Game over! Emitted to both players.

```javascript
socket.on("match_ended", (data) => {
  console.log(data);
  // {
  //   winnerId: "a1b2c3d4-...",    // or null for a draw
  //   reason: "correct_submission"  // or "opponent_eliminated", "timeout", "both_eliminated", "stage_complete"
  // }
  
  // Show the results screen
  // ELO has already been updated on the server
});
```

**Possible `reason` values:**

| Reason | Description |
|--------|-------------|
| `correct_submission` | A player solved the Boss Battle problem |
| `opponent_eliminated` | Opponent lost all lives |
| `both_eliminated` | Both players lost all lives (draw) |
| `timeout` | Boss Battle timer expired (draw) |
| `stage_complete` | A player completed all 6 stages |
| `opponent_timeout` | Opponent's decision timer expired |

---

## 4. TypeScript Interfaces

Copy these into your frontend project for type safety:

```typescript
// ── Match & Player Status ────────────────────────────────────────
type MatchStatus = 'LOBBY' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

type PlayerStatus =
  | 'CODING'              // Actively coding
  | 'WAITING_DECISION'    // Must choose Skip or Stay (15s timer)
  | 'STAYING'             // Chose STAY — coding with risk (wrong answers cost a life)
  | 'SKIPPED'             // Chose SKIP — lost 1 life, advancing
  | 'DONE'                // Solved current stage
  | 'ELIMINATED';         // 0 lives — out for the rest of the match

// ── Player State ─────────────────────────────────────────────────
interface PlayerState {
  userId: string;
  username: string;
  lives: number;                       // Global lives (start: 5)
  points: number;                      // Accumulated points
  status: PlayerStatus;
  currentDraft: string;                // Autosaved code from editor
  submissionsCount: number;
  stageScores: Record<number, number>; // { 1: 100, 2: 100, 3: 150 }
  decisionTimeout: number | null;      // Timestamp (ms) when decision expires
  currentStage: number;                // This player's personal stage (1–6)
  stageStartTime: number;              // Timestamp (ms) when player started current stage
  stageDuration: number;               // Total seconds for current stage
  stageTimeRemaining: number;          // Seconds left (recomputed every tick)
}

// ── Room State (the main game object) ────────────────────────────
interface RoomState {
  matchId: string;
  roomId: string;
  status: MatchStatus;
  currentStage: number;                // 1–5 = Sprint, 6 = Boss Battle
  stageTimeRemaining: number;          // Seconds (used for Boss Battle shared timer)
  stageEndTime: number;                // Timestamp (ms)
  playerIds: string[];                 // [player1Id, player2Id]
  problems: string[];                  // 6 problem UUIDs [easy, easy, med, hard, hard, boss]
  players: Record<string, PlayerState>;
}

// ── Submission Result (from submit_code) ─────────────────────────
interface SubmissionResult {
  status: 'ACCEPTED' | 'WRONG_ANSWER' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  passedCount: number;
  totalCount: number;
  testCases: TestCaseResult[];         // Only public test cases
  pointsAwarded: number;
  livesRemaining: number;
}

interface TestCaseResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  isPublic: boolean;
}

// ── Match Found (from matchmaking) ───────────────────────────────
interface MatchFound {
  roomId: string;
  opponentId: string;
  opponentUsername: string;
  opponentElo: number;
}

// ── Run Result (from run_code) ───────────────────────────────────
interface RunResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
```

---

## 5. Integration Guides

### Authentication Flow

```
┌──────────────┐     POST /api/auth/register      ┌──────────────┐
│   Frontend   │ ──────────────────────────────▶   │   Backend    │
│              │     { username, email, password }  │              │
│              │ ◀──────────────────────────────    │              │
│              │     { user, token }                │              │
│              │                                    │              │
│  Store token │     GET /api/users/me              │              │
│  in state    │ ──────────────────────────────▶   │  Verify JWT  │
│  (Zustand)   │     Authorization: Bearer <token>  │              │
│              │ ◀──────────────────────────────    │              │
│              │     { id, username, eloRating, ... }│              │
└──────────────┘                                    └──────────────┘
```

### Matchmaking Flow

```
1. User clicks "Find Match"
2. Frontend connects WebSocket: io("http://server", { auth: { token } })
3. Frontend emits: join_queue({ userId })
4. Wait for: queue_joined (searching...) or match_found (instant match)
5. On match_found: emit join_room({ roomId, userId })
6. Listen for room_state_update — game has begun!

Cancel: emit leave_queue({ userId }) to exit queue
```

### Match Lifecycle

```
┌─────────── SPRINT PHASE (Stages 1–5) ──────────────┐
│                                                      │
│  1. room_state_update arrives every 1 second         │
│  2. Read current problem: problems[player.currentStage - 1] │
│  3. Fetch problem details: GET /api/problems/:id     │
│  4. Player writes code, emit auto_save_draft         │
│  5. Player submits: emit submit_code                 │
│  6. Listen for submission_result                     │
│                                                      │
│  If ACCEPTED (first finisher):                       │
│    - Winner gets waiting_for_opponent                 │
│    - Loser gets opponent_completed_stage              │
│    - Loser must decide_skip_stay within 15s           │
│    - After decision: stage_advanced emitted           │
│                                                      │
│  If timer expires:                                   │
│    - Player loses 1 life, stage auto-advances         │
│    - 0 lives → ELIMINATED                            │
│                                                      │
├─────────── BOSS BATTLE (Stage 6) ───────────────────┤
│                                                      │
│  - Shared 20-minute timer                            │
│  - First correct submission = INSTANT WIN             │
│  - Wrong answer = −1 life                            │
│  - Can spend 100 pts for +1 life (redeem_life)       │
│  - Timer expires = DRAW                              │
│                                                      │
├─────────── MATCH ENDS ──────────────────────────────┤
│                                                      │
│  match_ended event with winnerId + reason            │
│  ELO automatically recalculated (K=32)               │
│  Show results screen, redirect to lobby              │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Game Rules Summary

| Stage | Difficulty | Points | Time | Notes |
|-------|-----------|--------|------|-------|
| 1 | EASY | 100 | 3 min | Sprint — personal timer per player |
| 2 | EASY | 100 | 3 min | Sprint |
| 3 | MEDIUM | 150 | 3 min | Sprint |
| 4 | HARD | 150 | 3 min | Sprint |
| 5 | HARD | 150 | 3 min | Sprint |
| 6 | BOSS | 300 | 20 min | Boss Battle — shared timer, first correct wins |

**Lives:** Start with 5. Lost by: skipping (-1), wrong answer during STAY (-1), wrong answer in Boss (-1), timeout (-1). At 0 → ELIMINATED.

**Points:** Earned by solving stages. Can be spent on life redemption (100 pts → +1 life) during Boss Battle.

**ELO:** Updated after every match using K=32 formula. Win = +ELO, Loss = −ELO, Draw = minimal change.

---

## 6. Error Handling

### REST API Errors

All errors follow this shape:
```json
{
  "error": "Human-readable error message"
}
```

| Status Code | Meaning | Common Causes |
|-------------|---------|---------------|
| 400 | Bad Request | Missing required fields, invalid data |
| 401 | Unauthorized | Missing/invalid/expired JWT token |
| 403 | Forbidden | User doesn't have admin role |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate username/email |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server bug (report it!) |

### WebSocket Errors

The server emits an `error` event for WebSocket errors:

```javascript
socket.on("error", (data) => {
  console.error(data.message);
  // Examples:
  // "userId is required to join the queue"
  // "Room does not exist or has expired"
  // "You are not a participant of this room"
  // "Match is not active"
  // "Cannot submit — you are ELIMINATED"
  // "Need at least 100 points to redeem a life (you have 50)"
});
```

### Supported Languages

| Language Key | Aliases | Notes |
|-------------|---------|-------|
| `python` | `python3` | Python 3 |
| `javascript` | `js` | Node.js |
| `cpp` | `c++` | G++ with -O2 |
| `c` | — | GCC |
| `java` | — | OpenJDK (Judge0 only) |
| `typescript` | `ts` | (Judge0 only) |
| `go` | — | (Judge0 only) |
| `rust` | — | (Judge0 only) |
| `ruby` | — | (Judge0 only) |

> When using the local executor (no Judge0), only `python`, `javascript`, and `cpp` are supported.

---

## Quick Start for Frontend Devs

```bash
# 1. Clone the battle server
git clone https://github.com/ishan2005/cosmodex.git battle-server
cd battle-server

# 2. Install & setup
npm install
npm run setup     # Generates Prisma client, runs migrations, seeds DB

# 3. Start the server
npm run dev       # Runs on http://localhost:3000

# 4. Test it
curl http://localhost:3000/health
curl http://localhost:3000/api/problems
curl http://localhost:3000/api/users
```

Then in your Next.js frontend:
```typescript
// Install socket.io-client
// npm install socket.io-client

import { io } from "socket.io-client";

const BATTLE_SERVER = "http://localhost:3000"; // or deployed URL

// REST calls
const res = await fetch(`${BATTLE_SERVER}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "test@example.com", password: "password123" }),
});
const { user, token } = await res.json();

// WebSocket
const socket = io(BATTLE_SERVER, { auth: { token } });
socket.emit("join_queue", { userId: user.id });
socket.on("match_found", (data) => {
  socket.emit("join_room", { roomId: data.roomId, userId: user.id });
});
```
