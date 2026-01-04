import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { type Language } from './use-code-execution';

interface WorkerState {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
}

const getWorkerURL = (filename: string): string => {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${filename}`.replace(/\/+/g, '/');
};

const workerFilenameMap: Record<Language, string> = {
  javascript: 'js-worker.js',
  typescript: 'js-worker.js',
  python: 'python-worker.js',
  racket: 'racket-worker.js',
};

const languageDisplayNames: Record<Language, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  racket: 'Racket',
};

export function useWorkerLoader() {
  const [workerStates, setWorkerStates] = useState<Record<string, WorkerState>>({});
  const loadingToastsRef = useRef<Record<string, string | number>>({});
  const workerTestsRef = useRef<Record<string, Worker>>({});

  const isWorkerReady = useCallback((language: Language): boolean => {
    return workerStates[language]?.isReady === true;
  }, [workerStates]);

  const isWorkerLoading = useCallback((language: Language): boolean => {
    return workerStates[language]?.isLoading === true;
  }, [workerStates]);

  const preloadWorker = useCallback((language: Language) => {
    if (workerStates[language]?.isReady || workerStates[language]?.isLoading) {
      return;
    }

    const workerFilename = workerFilenameMap[language];
    const workerPath = getWorkerURL(workerFilename);
    const displayName = languageDisplayNames[language];

    setWorkerStates(prev => ({
      ...prev,
      [language]: { isLoading: true, isReady: false, error: null }
    }));

    const toastId = toast.loading(`Loading ${displayName} runtime...`, {
      duration: Infinity,
    });
    loadingToastsRef.current[language] = toastId;

    const testWorker = new Worker(workerPath);
    workerTestsRef.current[language] = testWorker;

    const timeout = setTimeout(() => {
      testWorker.terminate();
      delete workerTestsRef.current[language];
      
      setWorkerStates(prev => ({
        ...prev,
        [language]: { isLoading: false, isReady: false, error: 'Loading timeout' }
      }));

      if (loadingToastsRef.current[language]) {
        toast.dismiss(loadingToastsRef.current[language]);
        delete loadingToastsRef.current[language];
      }
      
      toast.error(`${displayName} runtime loading timeout`);
    }, 60000);

    testWorker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      const data = e.data;

      if (data.type === 'ready' || data.type === 'status') {
        testWorker.terminate();
        delete workerTestsRef.current[language];

        setWorkerStates(prev => ({
          ...prev,
          [language]: { isLoading: false, isReady: true, error: null }
        }));

        if (loadingToastsRef.current[language]) {
          toast.dismiss(loadingToastsRef.current[language]);
          delete loadingToastsRef.current[language];
        }

        toast.success(`${displayName} runtime ready`);
      }
    };

    testWorker.onerror = (error) => {
      clearTimeout(timeout);
      testWorker.terminate();
      delete workerTestsRef.current[language];

      setWorkerStates(prev => ({
        ...prev,
        [language]: { isLoading: false, isReady: false, error: error.message }
      }));

      if (loadingToastsRef.current[language]) {
        toast.dismiss(loadingToastsRef.current[language]);
        delete loadingToastsRef.current[language];
      }

      toast.error(`${displayName} runtime failed to load`);
    };

    testWorker.postMessage({ code: '', language, testCases: [] });
  }, [workerStates]);

  useEffect(() => {
    return () => {
      Object.values(workerTestsRef.current).forEach(worker => {
        worker.terminate();
      });
      workerTestsRef.current = {};
      
      Object.values(loadingToastsRef.current).forEach(toastId => {
        toast.dismiss(toastId);
      });
      loadingToastsRef.current = {};
    };
  }, []);

  return {
    preloadWorker,
    isWorkerReady,
    isWorkerLoading,
    workerStates,
  };
}
