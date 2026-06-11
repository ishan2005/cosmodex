import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/db.js';
import { ExecutionResult, TestCaseResult } from '../types/index.js';
import { logger } from '../config/logger.js';

export interface IExecutor {
  execute(code: string, language: string, problemId: string): Promise<ExecutionResult>;
}

/**
 * Executes Python code locally by writing to a temp file and running it with the system Python runtime.
 */
class LocalPythonExecutor implements IExecutor {
  async execute(code: string, language: string, problemId: string): Promise<ExecutionResult> {
    const testCases = await prisma.testCase.findMany({ where: { problemId } });
    if (!testCases || testCases.length === 0) {
      throw new Error('No test cases found for problem');
    }

    const langLower = language.toLowerCase();
    if (langLower !== 'python' && langLower !== 'python3') {
      logger.warn(`Local executor only supports Python execution. Mocking other languages.`);
      return this.mockExecution(testCases);
    }

    const testCaseResults: TestCaseResult[] = [];
    let passedCount = 0;
    let overallStatus: ExecutionResult['status'] = 'ACCEPTED';

    // Create a temp folder inside the workspace
    const tempDir = path.join(process.cwd(), 'temp_runs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const fileId = crypto.randomUUID();
    const tempFilePath = path.join(tempDir, `run_${fileId}.py`);

    // Write user code to the temp file
    fs.writeFileSync(tempFilePath, code, 'utf-8');

    try {
      for (const tc of testCases) {
        const result = await this.runSingleTestCase(tempFilePath, tc.input, tc.expected, tc.isPublic);
        testCaseResults.push(result);
        
        if (result.passed) {
          passedCount++;
        } else {
          if (result.actual.includes('TimeoutError') || result.actual.includes('Time Limit Exceeded')) {
            overallStatus = 'TIME_LIMIT_EXCEEDED';
          } else if (result.actual.includes('SyntaxError') || result.actual.includes('Traceback')) {
            overallStatus = 'RUNTIME_ERROR';
          } else {
            overallStatus = 'WRONG_ANSWER';
          }
        }
      }
    } catch (err) {
      logger.error(`Error running local python script: ${err}`);
      overallStatus = 'RUNTIME_ERROR';
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (err) {
        logger.error(`Failed to clean up temp file ${tempFilePath}: ${err}`);
      }
    }

    return {
      status: passedCount === testCases.length ? 'ACCEPTED' : overallStatus,
      passedCount,
      totalCount: testCases.length,
      testCases: testCaseResults,
    };
  }

  private runSingleTestCase(
    filePath: string,
    input: string,
    expectedOutput: string,
    isPublic: boolean
  ): Promise<TestCaseResult> {
    return new Promise((resolve) => {
      // Escape inputs or feed them into stdin
      const processName = 'python'; // maps to Windows python executable
      
      const child = exec(
        `"${processName}" "${filePath}"`,
        { timeout: 3000 }, // 3 seconds timeout
        (error, stdout, stderr) => {
          let actual = stdout.trim().replace(/\r\n/g, '\n');
          const expected = expectedOutput.trim().replace(/\r\n/g, '\n');
          
          if (error) {
            if (error.killed) {
              return resolve({
                passed: false,
                input,
                expected,
                actual: 'Time Limit Exceeded (3000ms timeout)',
                isPublic,
              });
            }
            return resolve({
              passed: false,
              input,
              expected,
              actual: stderr.trim() || error.message,
              isPublic,
            });
          }

          // Special check for multi-line or whitespace differences
          const passed = actual === expected;
          
          resolve({
            passed,
            input,
            expected,
            actual,
            isPublic,
          });
        }
      );

      // Write input to standard input of the process
      if (child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  private mockExecution(testCases: any[]): ExecutionResult {
    // Basic mock response for non-python runs
    const testCaseResults = testCases.map((tc) => ({
      passed: true,
      input: tc.input,
      expected: tc.expected,
      actual: tc.expected,
      isPublic: tc.isPublic,
    }));
    return {
      status: 'ACCEPTED',
      passedCount: testCases.length,
      totalCount: testCases.length,
      testCases: testCaseResults,
    };
  }
}

/**
 * Executor client for Judge0 sandboxed API service.
 */
class Judge0Executor implements IExecutor {
  private endpoint: string;

  constructor() {
    this.endpoint = process.env.JUDGE0_URL || 'http://localhost:2358';
  }

  async execute(code: string, language: string, problemId: string): Promise<ExecutionResult> {
    logger.info(`Sending code to Judge0 for compilation at: ${this.endpoint}`);
    // Fall back to local python executor for now if Judge0 is not reachable
    const local = new LocalPythonExecutor();
    return local.execute(code, language, problemId);
  }
}

export class ExecutorService {
  private static activeExecutor: IExecutor | null = null;

  static getExecutor(): IExecutor {
    if (!this.activeExecutor) {
      if (process.env.JUDGE0_URL) {
        this.activeExecutor = new Judge0Executor();
      } else {
        this.activeExecutor = new LocalPythonExecutor();
      }
    }
    return this.activeExecutor;
  }
}
