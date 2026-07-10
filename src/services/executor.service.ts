import { prisma } from '../config/db.js';
import { ExecutionResult, TestCaseResult } from '../types/index.js';
import { logger } from '../config/logger.js';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface IExecutor {
  execute(code: string, language: string, problemId: string): Promise<ExecutionResult>;
  /** Run code once with custom stdin — no test cases, no match state changes. Used by the Run button. */
  runSingle(code: string, language: string, stdin: string): Promise<{ stdout: string; stderr: string; timedOut: boolean }>;
}

// ── JUDGE0 LANGUAGE ID MAP ────────────────────────────────────────
// Full list: https://ce.judge0.com/languages/
const LANGUAGE_IDS: Record<string, number> = {
  python:   71,  // Python 3 (3.8.1)
  python3:  71,
  javascript: 63, // Node.js 12.14.0
  js:       63,
  typescript: 74, // TypeScript 3.7.4
  ts:       74,
  cpp:      54,  // C++ (GCC 9.2.0)
  'c++':    54,
  c:        50,  // C (GCC 9.2.0)
  java:     62,  // Java (OpenJDK 13.0.1)
  go:       60,  // Go (1.13.5)
  rust:     73,  // Rust (1.40.0)
  ruby:     72,  // Ruby (2.7.0)
};

// Judge0 status IDs
const JUDGE0_STATUS: Record<number, ExecutionResult['status']> = {
  3:  'ACCEPTED',
  4:  'WRONG_ANSWER',
  5:  'TIME_LIMIT_EXCEEDED',
  6:  'RUNTIME_ERROR',  // Compilation Error
  7:  'RUNTIME_ERROR',
  8:  'RUNTIME_ERROR',
  9:  'RUNTIME_ERROR',
  10: 'RUNTIME_ERROR',
  11: 'RUNTIME_ERROR',
  12: 'RUNTIME_ERROR',
};

interface Judge0Response {
  token: string;
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
  memory: number | null;
}

/**
 * Encodes a string to base64 (Judge0 requires base64-encoded payloads).
 */
function b64(str: string): string {
  return Buffer.from(str).toString('base64');
}

/**
 * Decodes a base64 string. Returns '' on null.
 */
function decodeB64(str: string | null): string {
  if (!str) return '';
  return Buffer.from(str, 'base64').toString('utf-8');
}

/**
 * Judge0Executor:
 * Submits each test case to a running Judge0 CE instance, polls for the result,
 * and aggregates into our ExecutionResult format.
 *
 * Required env: JUDGE0_URL (e.g. "http://localhost:2358")
 * Optional env: JUDGE0_AUTH_TOKEN (if Judge0 is deployed with auth header)
 */
class Judge0Executor implements IExecutor {
  private readonly endpoint: string;
  private readonly authToken: string | undefined;
  private readonly POLL_INTERVAL_MS = 400;
  private readonly POLL_TIMEOUT_MS  = 15_000;
  /** Maximum number of test cases to batch in one request */
  private readonly MAX_BATCH_SIZE = 20;

  constructor() {
    this.endpoint  = (process.env.JUDGE0_URL || 'http://localhost:2358').replace(/\/$/, '');
    this.authToken = process.env.JUDGE0_AUTH_TOKEN;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['X-Auth-Token'] = this.authToken;
    return h;
  }

  /**
   * Submit code + stdin to Judge0 (single submission) — used by runSingle.
   */
  private async submit(
    code: string,
    languageId: number,
    stdin: string,
    timeLimitSec: number
  ): Promise<string> {
    const body = {
      source_code: b64(code),
      language_id: languageId,
      stdin: b64(stdin),
      cpu_time_limit: timeLimitSec,
      memory_limit: 131072, // 128 MB in KB
    };

    const res = await fetch(`${this.endpoint}/submissions?base64_encoded=true&wait=false`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Judge0 submit failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { token: string };
    return data.token;
  }

  /**
   * Submit ALL test cases in a single batch request to Judge0.
   * Returns an array of tokens (one per submission).
   */
  private async submitBatch(
    code: string,
    languageId: number,
    testCases: { input: string }[],
    timeLimitSec: number
  ): Promise<string[]> {
    const submissions = testCases.map((tc) => ({
      source_code: b64(code),
      language_id: languageId,
      stdin: b64(tc.input),
      cpu_time_limit: timeLimitSec,
      memory_limit: 131072,
    }));

    const res = await fetch(`${this.endpoint}/submissions/batch?base64_encoded=true`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify({ submissions }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Judge0 batch submit failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { token: string }[];
    return data.map((d) => d.token);
  }

  /**
   * Poll Judge0 until the submission leaves the queue/processing state.
   * Throws if polling times out.
   */
  private async pollResult(token: string): Promise<Judge0Response> {
    const deadline = Date.now() + this.POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.POLL_INTERVAL_MS));

      const res = await fetch(
        `${this.endpoint}/submissions/${token}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory`,
        { headers: this.headers }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Judge0 poll failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as Judge0Response;

      // Status 1 = In Queue, 2 = Processing — keep polling
      if (data.status.id !== 1 && data.status.id !== 2) {
        return data;
      }
    }

    throw new Error(`Judge0 polling timed out after ${this.POLL_TIMEOUT_MS}ms for token ${token}`);
  }

  /**
   * Poll ALL tokens in a single batch GET request.
   * Returns results for completed submissions; unfinished ones will be polled again.
   */
  private async pollBatchResults(tokens: string[]): Promise<Judge0Response[]> {
    const deadline = Date.now() + this.POLL_TIMEOUT_MS;
    const results: (Judge0Response | null)[] = new Array(tokens.length).fill(null);
    const pendingIndices = tokens.map((_, i) => i);

    while (pendingIndices.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.POLL_INTERVAL_MS));

      const pendingTokens = pendingIndices.map((i) => tokens[i]);
      const tokenStr = pendingTokens.join(',');

      const res = await fetch(
        `${this.endpoint}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=token,status,stdout,stderr,compile_output,time,memory`,
        { headers: this.headers }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Judge0 batch poll failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as { submissions: Judge0Response[] };
      const submissions = data.submissions || data as unknown as Judge0Response[];

      // Match results back to their original indices
      const newPending: number[] = [];
      for (let j = 0; j < pendingIndices.length; j++) {
        const origIdx = pendingIndices[j];
        const sub = submissions[j];
        if (sub && sub.status.id !== 1 && sub.status.id !== 2) {
          results[origIdx] = sub;
        } else {
          newPending.push(origIdx);
        }
      }
      pendingIndices.length = 0;
      pendingIndices.push(...newPending);
    }

    if (pendingIndices.length > 0) {
      throw new Error(`Judge0 batch polling timed out — ${pendingIndices.length} submissions still pending`);
    }

    return results as Judge0Response[];
  }

  /**
   * Convert a Judge0 result into our TestCaseResult format.
   */
  private parseResult(
    result: Judge0Response,
    tc: { input: string; expected: string; isPublic: boolean }
  ): TestCaseResult {
    const actual   = decodeB64(result.stdout).trim().replace(/\r\n/g, '\n');
    const expected = tc.expected.trim().replace(/\r\n/g, '\n');

    if (result.status.id === 3) {
      return {
        passed:   actual === expected,
        input:    tc.input,
        expected,
        actual,
        isPublic: tc.isPublic,
      };
    }

    const errOutput =
      decodeB64(result.compile_output) ||
      decodeB64(result.stderr) ||
      result.status.description;

    return {
      passed:   false,
      input:    tc.input,
      expected,
      actual:   errOutput.substring(0, 500),
      isPublic: tc.isPublic,
    };
  }

  async execute(code: string, language: string, problemId: string): Promise<ExecutionResult> {
    const langKey    = language.toLowerCase();
    const languageId = LANGUAGE_IDS[langKey];

    if (!languageId) {
      throw new Error(
        `Language "${language}" is not supported. Supported: ${Object.keys(LANGUAGE_IDS).join(', ')}`
      );
    }

    const [testCases, problem] = await Promise.all([
      prisma.testCase.findMany({ where: { problemId } }),
      prisma.problem.findUnique({ where: { id: problemId }, select: { timeLimitSec: true } }),
    ]);

    if (testCases.length === 0) {
      throw new Error(`No test cases found for problem ${problemId}`);
    }

    const timeLimitSec = problem?.timeLimitSec ?? 3;
    logger.info(`[Judge0] Batch executing ${testCases.length} test cases | lang=${language} | timeLimit=${timeLimitSec}s`);

    // ── BATCH SUBMIT: send ALL test cases in one HTTP call ────────
    const tokens = await this.submitBatch(code, languageId, testCases, timeLimitSec);

    // ── BATCH POLL: poll all tokens at once ───────────────────────
    const judge0Results = await this.pollBatchResults(tokens);

    // ── AGGREGATE RESULTS ─────────────────────────────────────────
    const results: TestCaseResult[] = [];
    let passedCount = 0;
    let finalStatus: ExecutionResult['status'] = 'ACCEPTED';

    for (let i = 0; i < testCases.length; i++) {
      const result = this.parseResult(judge0Results[i], testCases[i]);
      results.push(result);

      if (result.passed) {
        passedCount++;
      } else if (finalStatus === 'ACCEPTED') {
        const out = result.actual.toLowerCase();
        if (out.includes('time limit') || out.includes('timed out')) {
          finalStatus = 'TIME_LIMIT_EXCEEDED';
        } else if (
          out.includes('error') ||
          out.includes('exception') ||
          out.includes('traceback')
        ) {
          finalStatus = 'RUNTIME_ERROR';
        } else {
          finalStatus = 'WRONG_ANSWER';
        }
      }
    }

    const allPassed = passedCount === testCases.length;
    logger.info(`[Judge0] Result: ${passedCount}/${testCases.length} → ${allPassed ? 'ACCEPTED' : finalStatus}`);

    return {
      status:     allPassed ? 'ACCEPTED' : finalStatus,
      passedCount,
      totalCount: testCases.length,
      testCases:  results,
    };
  }

  /**
   * Run code once with custom stdin — used by the Run button (no test cases, no match state).
   * Submits to Judge0 using a 5-second wall time limit.
   */
  async runSingle(code: string, language: string, stdin: string): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    const langKey    = language.toLowerCase();
    const languageId = LANGUAGE_IDS[langKey];

    if (!languageId) {
      return { stdout: '', stderr: `Language "${language}" is not supported.`, timedOut: false };
    }

    logger.info(`[Judge0] runSingle | lang=${language}`);

    const token = await this.submit(code, languageId, stdin, 5);
    const result = await this.pollResult(token);

    const stdout = decodeB64(result.stdout);
    const stderr = decodeB64(result.stderr) || decodeB64(result.compile_output);
    const timedOut = result.status.id === 5; // TIME_LIMIT_EXCEEDED

    return { stdout, stderr, timedOut };
  }
}

// ── LOCAL MULTI-LANGUAGE EXECUTOR ────────────────────────────────
// Runs code natively inside the container using installed runtimes.
// Supports: Python 3 (python3), JavaScript (node), C++ (g++).
// Java is not supported in this environment (requires JDK).

const TEMP_DIR = path.join(process.cwd(), 'temp_runs');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });


type LangConfig = {
  ext: string;
  /** Returns the command + args to execute the given source file */
  getCmd: (src: string, bin: string) => { cmd: string; args: string[] };
  /** Optional compile step before running; null = interpret directly */
  compile?: (src: string, bin: string) => { cmd: string; args: string[] };
};

// BUG 8 FIX: On Windows dev environments, 'python3' may not exist (only 'python' is in PATH).
// Use 'python' as the command on win32; production Docker always runs Linux where python3 is correct.
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

const LANG_CONFIGS: Record<string, LangConfig> = {
  python:     { ext: 'py',  getCmd: (src) => ({ cmd: PYTHON_CMD, args: [src] }) },
  python3:    { ext: 'py',  getCmd: (src) => ({ cmd: PYTHON_CMD, args: [src] }) },
  javascript: { ext: 'js',  getCmd: (src) => ({ cmd: 'node',    args: [src] }) },
  js:         { ext: 'js',  getCmd: (src) => ({ cmd: 'node',    args: [src] }) },
  cpp:        {
    ext: 'cpp',
    compile:  (src, bin) => ({ cmd: 'g++', args: ['-O2', '-o', bin, src] }),
    getCmd:   (_src, bin) => ({ cmd: bin, args: [] }),
  },
  'c++':      {
    ext: 'cpp',
    compile:  (src, bin) => ({ cmd: 'g++', args: ['-O2', '-o', bin, src] }),
    getCmd:   (_src, bin) => ({ cmd: bin, args: [] }),
  },
};

function spawnWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; timedOut: boolean; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        timedOut: !!(error?.killed || error?.signal === 'SIGTERM'),
        exitCode: typeof error?.code === 'number' ? error.code : (error ? -1 : 0),
      });
    });
    if (child.stdin) {
      // Suppress EPIPE — thrown when the child exits before reading all of stdin
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') throw err; // only swallow EPIPE, re-throw anything else
      });
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

/** Max concurrent child processes for local test case execution */
const LOCAL_CONCURRENCY = 4;

/**
 * Run items through an async function with bounded concurrency.
 */
async function parallelMap<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

class LocalMultiExecutor implements IExecutor {
  async execute(code: string, language: string, problemId: string): Promise<ExecutionResult> {
    const langKey = language.toLowerCase();
    const config = LANG_CONFIGS[langKey];

    const [testCases, problem] = await Promise.all([
      prisma.testCase.findMany({ where: { problemId } }),
      prisma.problem.findUnique({ where: { id: problemId }, select: { timeLimitSec: true } }),
    ]);

    if (testCases.length === 0) throw new Error(`No test cases found for problem ${problemId}`);

    const timeoutMs = (problem?.timeLimitSec ?? 3) * 1000 + 2000; // generous buffer

    if (!config) {
      const unsupportedResult: TestCaseResult[] = testCases.map((tc) => ({
        passed: false,
        input: tc.input,
        expected: tc.expected,
        actual: `Language "${language}" is not supported. Use Python, JavaScript, or C++.`,
        isPublic: tc.isPublic,
      }));
      return { status: 'RUNTIME_ERROR', passedCount: 0, totalCount: testCases.length, testCases: unsupportedResult };
    }

    const runId  = crypto.randomUUID();
    const srcPath = path.join(TEMP_DIR, `run_${runId}.${config.ext}`);
    const binPath = path.join(TEMP_DIR, `run_${runId}`);

    fs.writeFileSync(srcPath, code, 'utf-8');

    try {
      // ── COMPILE (C++ only) ────────────────────────────────────
      if (config.compile) {
        const { cmd, args } = config.compile(srcPath, binPath);
        const compileOut = await spawnWithStdin(cmd, args, '', 15_000);

        if (compileOut.exitCode !== 0 || compileOut.timedOut) {
          const errMsg = compileOut.stderr.trim().substring(0, 600) || 'Compilation failed';
          logger.warn(`[LocalExec] Compile error for ${language}: ${errMsg}`);
          const results: TestCaseResult[] = testCases.map((tc) => ({
            passed: false, input: tc.input, expected: tc.expected, actual: `Compilation Error:\n${errMsg}`, isPublic: tc.isPublic
          }));
          return { status: 'RUNTIME_ERROR', passedCount: 0, totalCount: testCases.length, testCases: results };
        }
        try { fs.chmodSync(binPath, 0o755); } catch (_) { /* ignore */ }
      }

      // ── RUN TEST CASES IN PARALLEL ─────────────────────────────
      const results = await parallelMap(testCases, LOCAL_CONCURRENCY, async (tc): Promise<TestCaseResult> => {
        const { cmd, args } = config.getCmd(srcPath, binPath);
        const run = await spawnWithStdin(cmd, args, tc.input, timeoutMs);

        const actual   = run.stdout.trim().replace(/\r\n/g, '\n');
        const expected = tc.expected.trim().replace(/\r\n/g, '\n');

        if (run.timedOut) {
          return { passed: false, input: tc.input, expected, actual: `Time Limit Exceeded (>${timeoutMs}ms)`, isPublic: tc.isPublic };
        } else if (run.stderr && !actual) {
          const errMsg = run.stderr.trim().substring(0, 400);
          return { passed: false, input: tc.input, expected, actual: errMsg, isPublic: tc.isPublic };
        } else {
          const passed = actual === expected;
          return { passed, input: tc.input, expected, actual, isPublic: tc.isPublic };
        }
      });

      // ── AGGREGATE RESULTS ──────────────────────────────────────
      let passedCount = 0;
      let finalStatus: ExecutionResult['status'] = 'ACCEPTED';

      for (const result of results) {
        if (result.passed) {
          passedCount++;
        } else if (finalStatus === 'ACCEPTED') {
          const out = result.actual.toLowerCase();
          if (out.includes('time limit') || out.includes('timed out')) {
            finalStatus = 'TIME_LIMIT_EXCEEDED';
          } else if (out.includes('error') || out.includes('exception') || out.includes('traceback')) {
            finalStatus = 'RUNTIME_ERROR';
          } else {
            finalStatus = 'WRONG_ANSWER';
          }
        }
      }

      const allPassed = passedCount === testCases.length;
      logger.info(`[LocalExec] ${language} | ${passedCount}/${testCases.length} → ${allPassed ? 'ACCEPTED' : finalStatus}`);
      return { status: allPassed ? 'ACCEPTED' : finalStatus, passedCount, totalCount: testCases.length, testCases: results };
    } finally {
      // Cleanup temp files
      try { if (fs.existsSync(srcPath)) fs.rmSync(srcPath, { force: true }); } catch (_) { /* ignore */ }
      try { if (fs.existsSync(binPath)) fs.rmSync(binPath, { force: true }); } catch (_) { /* ignore */ }
    }
  }

  /** Run code once with custom stdin — no test cases, no match state changes. Used by the Run button. */
  async runSingle(code: string, language: string, stdin: string): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    const langKey = language.toLowerCase();
    const config = LANG_CONFIGS[langKey];

    if (!config) {
      return { stdout: '', stderr: `Language "${language}" is not supported. Use Python, JavaScript, or C++.`, timedOut: false };
    }

    const runId  = crypto.randomUUID();
    const srcPath = path.join(TEMP_DIR, `run_${runId}.${config.ext}`);
    const binPath = path.join(TEMP_DIR, `run_${runId}`);
    fs.writeFileSync(srcPath, code, 'utf-8');

    try {
      if (config.compile) {
        const { cmd, args } = config.compile(srcPath, binPath);
        const compileOut = await spawnWithStdin(cmd, args, '', 15_000);
        if (compileOut.exitCode !== 0 || compileOut.timedOut) {
          return { stdout: '', stderr: `Compilation Error:\n${compileOut.stderr.trim().substring(0, 800)}`, timedOut: false };
        }
        try { fs.chmodSync(binPath, 0o755); } catch (_) { /* ignore */ }
      }

      const { cmd, args } = config.getCmd(srcPath, binPath);
      const run = await spawnWithStdin(cmd, args, stdin, 5000);
      return { stdout: run.stdout, stderr: run.stderr, timedOut: run.timedOut };
    } finally {
      try { if (fs.existsSync(srcPath)) fs.rmSync(srcPath, { force: true }); } catch (_) { /* ignore */ }
      try { if (fs.existsSync(binPath)) fs.rmSync(binPath, { force: true }); } catch (_) { /* ignore */ }
    }
  }
}

// ── EXECUTOR SERVICE ──────────────────────────────────────────────
export class ExecutorService {
  private static instance: IExecutor | null = null;

  /**
   * Returns the active executor.
   *
   * Selection logic (checked once, then cached):
   *   JUDGE0_URL set in env  →  Judge0Executor  (sandboxed, supports 60+ languages)
   *   JUDGE0_URL not set     →  LocalMultiExecutor  (direct child_process, dev-only)
   *
   * To enable Judge0 in development, set JUDGE0_URL=http://localhost:2358 in .env
   * and run: docker compose up -d judge0-server judge0-worker-1 judge0-worker-2
   */
  static getExecutor(): IExecutor {
    if (!this.instance) {
      if (process.env.JUDGE0_URL) {
        this.instance = new Judge0Executor();
        logger.info(`[Executor] Using Judge0Executor → ${process.env.JUDGE0_URL}`);
      } else {
        this.instance = new LocalMultiExecutor();
        logger.info('[Executor] JUDGE0_URL not set — falling back to LocalMultiExecutor (python / node / g++)');
        logger.warn('[Executor] LocalMultiExecutor runs untrusted code directly. Do NOT use in production without Docker sandboxing.');
      }
    }
    return this.instance;
  }

  /** Run code with custom stdin — no match state changes. Used by the Run button. */
  static async runSingle(code: string, language: string, stdin: string) {
    return ExecutorService.getExecutor().runSingle(code, language, stdin);
  }

  /** Force a new executor instance (useful after env changes in tests) */
  static reset(): void {
    this.instance = null;
  }
}






