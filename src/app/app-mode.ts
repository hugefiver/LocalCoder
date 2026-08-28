export type AppMode = "all" | "executor" | "problems";

function normalizeMode(value: unknown): AppMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "all") return "all";
  if (normalized === "executor" || normalized === "exec") return "executor";
  if (normalized === "problems" || normalized === "problem" || normalized === "leetcode") return "problems";
  return "all";
}

export const APP_MODE: AppMode = normalizeMode(import.meta.env.VITE_APP_MODE);
export const ENABLE_EXECUTOR = APP_MODE === "all" || APP_MODE === "executor";
export const ENABLE_PROBLEMS = APP_MODE === "all" || APP_MODE === "problems";
