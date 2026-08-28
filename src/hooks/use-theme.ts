import { createContext, useContext } from "react";

import type { SettingsRecord } from "../storage/schema.js";

export type ThemeMode = SettingsRecord["theme"];
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => Promise<void>;
  persistenceError: string | null;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
