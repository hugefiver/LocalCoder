import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LocalCoderRepository } from "../storage/repository.js";
import type { SettingsRecord } from "../storage/schema.js";
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemeMode,
} from "../hooks/use-theme.js";

export function ThemeProvider({
  children,
  storage,
}: {
  children: ReactNode;
  storage: LocalCoderRepository;
}) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(systemTheme);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const settingsRef = useRef<SettingsRecord | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void storage.getSettings().then((settings) => {
      if (cancelled) return;
      settingsRef.current = settings;
      setThemeState(settings.theme);
      setPersistenceError(null);
    }).catch((error: unknown) => {
      if (!cancelled) setPersistenceError(`主题设置无法读取：${errorReason(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const nextResolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(nextResolved);
      setResolvedTheme(nextResolved);
    };
    applyTheme();
    if (theme !== "system") return undefined;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: ThemeMode): Promise<void> => {
    setThemeState(nextTheme);
    const currentSettings = settingsRef.current;
    if (currentSettings === null) {
      const message = "主题设置尚未完成加载，本次选择未保存";
      setPersistenceError(message);
      return Promise.reject(new Error(message));
    }

    const nextSettings: SettingsRecord = {
      ...currentSettings,
      theme: nextTheme,
      updatedAt: Date.now(),
    };
    settingsRef.current = nextSettings;
    const save = saveQueueRef.current
      .catch(() => undefined)
      .then(() => storage.saveSettings(nextSettings));
    saveQueueRef.current = save;
    return save.then(() => {
      if (mountedRef.current) setPersistenceError(null);
    }).catch((error: unknown) => {
      if (mountedRef.current) {
        setPersistenceError(`主题选择未保存：${errorReason(error)}`);
      }
      throw error;
    });
  }, [storage]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    persistenceError,
  }), [persistenceError, resolvedTheme, setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}
