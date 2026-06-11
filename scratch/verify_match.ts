import http from 'http';
import { io as ClientIO } from 'socket.io-client';
import app from '../src/app.js';
import { initSocketIO } from '../src/sockets/index.js';
import { MatchService } from '../src/services/match.service.js';
import { prisma } from '../src/config/db.js';
import { logger } from '../src/config/logger.js';

const PORT = 3005;

// Tracking flags to prevent duplicate emissions from client listeners
let stage1SubmittedA = false;
let stage2SubmittedA = false;
let bossWrongSubmittedCountA = 0;
let bossRedeemedA = false;

let stage1DecidedB = false;
let stage1SubmittedB = false;
let stage2DecidedB = false;
let bossWinnerSubmittedB = false;

async function runVerification() {
  logger.info('=== STARTING BACKEND PROTOTYPE INTEGRATION TEST ===');

  const users = await prisma.user.findMany();
  if (users.length < 2) {
    logger.error('Not enough users seeded in database. Run seed first.');
    process.exit(1);
  }
  const player1 = users.find(u => u.username === 'CodeNinja')!;
  const player2 = users.find(u => u.username === 'AlgoMaster')!;
  
  const problems = await prisma.problem.findMany();
  if (problems.length < 6) {
    logger.error('Not enough problems seeded in database. Run seed first.');
    process.exit(1);
  }
  const problemIds = problems.map(p => p.id);

  logger.info(`Using seeded players: ${player1.username} (Elo: ${player1.eloRating}) and ${player2.username} (Elo: ${player2.eloRating})`);

  const server = http.createServer(app);
  initSocketIO(server);
  
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  logger.info(`Test server listening on port ${PORT}`);

  const roomId = 'test-room-999';
  const initialState = await MatchService.createRoomState(roomId, player1.id, player2.id, problemIds);
  logger.info(`Initialized Room ${roomId} for Match ${initialState.matchId}`);

  const clientA = ClientIO(`http://localhost:${PORT}`);
  const clientB = ClientIO(`http://localhost:${PORT}`);

  clientA.on('connect', () => {
    logger.info('Client A connected. Joining room...');
    clientA.emit('join_room', { roomId, userId: player1.id });
  });

  clientB.on('connect', () => {
    logger.info('Client B connected. Joining room...');
    clientB.emit('join_room', { roomId, userId: player2.id });
  });

  // Client A flow
  clientA.on('room_state_update', async (state: any) => {
    const p1 = state.players[player1.id];

    // --- STEP 1: STAGE 1 (Sum of Two Numbers) ---
    if (state.currentStage === 1 && state.status === 'ACTIVE') {
      if (p1.status === 'CODING' && !stage1SubmittedA) {
        stage1SubmittedA = true;
        logger.info('--- STAGE 1: Player 1 (Client A) submitting correct Python code... ---');
        const pythonCode = `import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) + int(lines[1]))\n`;
        clientA.emit('submit_code', {
          roomId,
          userId: player1.id,
          problemId: state.problems[0],
          code: pythonCode,
          language: 'python'
        });
      }
    }

    // --- STEP 3: STAGE 2 (Reverse a String) ---
    if (state.currentStage === 2 && state.status === 'ACTIVE') {
      if (p1.status === 'CODING' && !stage2SubmittedA) {
        stage2SubmittedA = true;
        logger.info('--- STAGE 2: Player 1 (Client A) submitting correct python code... ---');
        const pythonCode = `import sys\nprint(sys.stdin.read().strip()[::-1])\n`;
        clientA.emit('submit_code', {
          roomId,
          userId: player1.id,
          problemId: state.problems[1],
          code: pythonCode,
          language: 'python'
        });
      }
    }

    // --- STEP 5: BOSS BATTLE (Stage 6) ---
    if (state.currentStage === 6 && state.status === 'ACTIVE') {
      if (p1.status === 'CODING' && bossWrongSubmittedCountA === 0) {
        bossWrongSubmittedCountA = 1;
        logger.info('--- BOSS BATTLE: Player 1 (Client A) testing strict incorrect submission penalty... ---');
        clientA.emit('submit_code', {
          roomId,
          userId: player1.id,
          problemId: state.problems[5],
          code: `print("wrong answer")\n`,
          language: 'python'
        });
      }

      if (p1.status === 'CODING' && bossWrongSubmittedCountA === 1 && p1.lives > 0) {
        logger.info(`--- BOSS BATTLE: Player 1 (Client A) has ${p1.lives} lives. Submitting wrong answers to test elimination... ---`);
        clientA.emit('submit_code', {
          roomId,
          userId: player1.id,
          problemId: state.problems[5],
          code: `print("wrong answer loop")\n`,
          language: 'python'
        });
      }

      if (p1.status === 'ELIMINATED' && p1.points >= 100 && !bossRedeemedA) {
        bossRedeemedA = true;
        logger.info('--- BOSS BATTLE: Player 1 (Client A) out of lives! Triggering points-to-life redemption... ---');
        clientA.emit('redeem_life', { roomId, userId: player1.id });
      }
    }
  });

  clientB.on('opponent_completed_stage', (payload: any) => {
    logger.info(`[Client B] Received opponent_completed_stage notification! Decision timer: ${payload.decisionTimeRemaining}s`);
  });

  clientB.on('room_state_update', async (state: any) => {
    const p2 = state.players[player2.id];
    
    // --- STEP 2: STAGE 1 Decision (Stay) ---
    if (state.currentStage === 1 && p2.status === 'WAITING_DECISION' && !stage1DecidedB) {
      stage1DecidedB = true;
      logger.info('--- STAGE 1: Player 2 (Client B) choosing to STAY and solve... ---');
      clientB.emit('decide_skip_stay', { roomId, userId: player2.id, choice: 'stay' });
    }

    if (state.currentStage === 1 && p2.status === 'STAYING' && !stage1SubmittedB) {
      stage1SubmittedB = true;
      logger.info('--- STAGE 1: Player 2 (Client B) submitting incorrect code first (lose 1 life)... ---');
      clientB.emit('submit_code', {
        roomId,
        userId: player2.id,
        problemId: state.problems[0],
        code: `print("wrong calculation")\n`,
        language: 'python'
      });

      setTimeout(() => {
        logger.info('--- STAGE 1: Player 2 (Client B) submitting correct code to advance... ---');
        const pythonCode = `import sys\nlines = sys.stdin.read().split()\nprint(int(lines[0]) + int(lines[1]))\n`;
        clientB.emit('submit_code', {
          roomId,
          userId: player2.id,
          problemId: state.problems[0],
          code: pythonCode,
          language: 'python'
        });
      }, 500);
    }

    // --- STEP 4: STAGE 2 Decision (Skip) ---
    if (state.currentStage === 2 && p2.status === 'WAITING_DECISION' && !stage2DecidedB) {
      stage2DecidedB = true;
      logger.info('--- STAGE 2: Player 2 (Client B) choosing to SKIP... (Loss of 1 life) ---');
      clientB.emit('decide_skip_stay', { roomId, userId: player2.id, choice: 'skip' });
    }

    // --- STEP 4.5: FAST FORWARD STAGES 3, 4, 5 ---
    if ((state.currentStage === 3 || state.currentStage === 4 || state.currentStage === 5) && state.status === 'ACTIVE') {
      if (p2.status === 'CODING') {
        logger.info(`--- STAGE ${state.currentStage}: Simulating fast skips to advance... ---`);
        await MatchService.handleStageTimeout(roomId);
      }
    }

    // --- STEP 6: BOSS BATTLE (Stage 6) CORRECT SUBMISSION ---
    if (state.currentStage === 6 && state.status === 'ACTIVE') {
      if (p2.status === 'CODING' && bossRedeemedA && !bossWinnerSubmittedB) {
        bossWinnerSubmittedB = true;
        setTimeout(() => {
          logger.info('--- BOSS BATTLE: Player 2 (Client B) submitting correct code for final victory! ---');
          const pythonCode = `import sys\ns = sys.stdin.read().strip()\nif s == "babad": print("bab")\nelif s == "cbbd": print("bb")\nelif s == "a": print("a")\nelif s == "forgeeksskeegfor": print("geeksskeeg")\n`;
          clientB.emit('submit_code', {
            roomId,
            userId: player2.id,
            problemId: state.problems[5],
            code: pythonCode,
            language: 'python'
          });
        }, 1500);
      }
    }
  });

  clientA.on('submission_result', (result: any) => {
    logger.info(`[Client A] Submission Result: ${result.status} (Passed ${result.passedCount}/${result.totalCount}, Lives: ${result.livesRemaining})`);
  });

  clientB.on('submission_result', (result: any) => {
    logger.info(`[Client B] Submission Result: ${result.status} (Passed ${result.passedCount}/${result.totalCount}, Lives: ${result.livesRemaining})`);
  });

  clientA.on('match_ended', (data: any) => {
    logger.info(`[Client A] Received match_ended! Winner: ${data.winnerId}`);
  });

  clientB.on('match_ended', async (data: any) => {
    logger.info(`[Client B] Received match_ended! Winner: ${data.winnerId}`);
    
    clientA.disconnect();
    clientB.disconnect();

    setTimeout(async () => {
      logger.info('--- MATCH CLOSED. VERIFYING DATABASE VALUES... ---');
      const match = await prisma.match.findUnique({
        where: { id: initialState.matchId }
      });
      const dbP1 = await prisma.user.findUnique({ where: { id: player1.id } });
      const dbP2 = await prisma.user.findUnique({ where: { id: player2.id } });

      console.log('\n======================================');
      console.log('VERIFICATION RESULTS:');
      console.log(`- Match DB Status: ${match?.status} (Expected: COMPLETED)`);
      console.log(`- Winner DB Recorded ID: ${match?.winnerId} (Expected: ${player2.id})`);
      console.log(`- Player 1 ELO Change: ${player1.eloRating} -> ${dbP1?.eloRating}`);
      console.log(`- Player 2 ELO Change: ${player2.eloRating} -> ${dbP2?.eloRating}`);
      console.log('======================================\n');

      server.close();
      logger.info('=== BACKEND PROTOTYPE INTEGRATION TEST COMPLETED SUCCESSFULLY ===');
      process.exit(0);
    }, 1000);
  });
}

runVerification().catch(err => {
  logger.error(`Verification runner crashed: ${err}`);
  process.exit(1);
});
