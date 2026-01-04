import { useState, useCallback, useRef } from 'react';

export type Language = 'javascript' | 'typescript' | 'python' | 'racket';

interface TestCase {
  input: any;
  expected: any;
}

interface TestResult {
  input: any;
  expected: any;
  actual: any;
  passed: boolean;
  error?: string;
  logs?: string;
}

interface ExecutionResult {
  success: boolean;
  results?: TestResult[];
  executionTime?: number;
  error?: string;
  stack?: string;
}

const getWorkerURL = (filename: string): string => {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${filename}`.replace(/\/+/g, '/');
};

export function useCodeExecution() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const executeCode = useCallback(async (code: string, language: Language, testCases: TestCase[]) => {
    setIsRunning(true);
    setResult(null);

    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const workerFilename = {
      javascript: 'js-worker.js',
      typescript: 'js-worker.js',
      python: 'python-worker.js',
      racket: 'racket-worker.js',
    }[language];

    const workerPath = getWorkerURL(workerFilename);

    return new Promise<ExecutionResult>((resolve) => {
      const worker = new Worker(workerPath);
      workerRef.current = worker;

      const timeout = setTimeout(() => {
        worker.terminate();
        const timeoutResult = {
          success: false,
          error: 'Execution timeout (30 seconds)',
        };
        setResult(timeoutResult);
        setIsRunning(false);
        resolve(timeoutResult);
      }, 30000);

      worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        
        if (data.type === 'status') {
          return;
        }
        
        clearTimeout(timeout);
        setResult(data);
        setIsRunning(false);
        worker.terminate();
        resolve(data);
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        const errorResult = {
          success: false,
          error: error.message,
        };
        setResult(errorResult);
        setIsRunning(false);
        worker.terminate();
        resolve(errorResult);
      };

      worker.postMessage({ code, language, testCases });
    });
  }, []);

  const cleanup = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  return { executeCode, isRunning, result, cleanup };
}
