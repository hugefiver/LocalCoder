import { type ReactNode, useEffect, useState } from "react";

import { AppServicesContext } from "../hooks/use-app-services.js";
import {
  createAppServices,
  type AppServices,
} from "../services/app-services.js";
import { ThemeProvider } from "./ThemeProvider.js";

type BootState =
  | { kind: "loading" }
  | { kind: "ready"; services: AppServices }
  | { kind: "fatal"; error: Error };

export function AppProviders({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<BootState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let createdServices: AppServices | undefined;

    void createAppServices().then((services) => {
      createdServices = services;
      if (cancelled) {
        safelyDispose(services);
        return;
      }
      setBoot({ kind: "ready", services });
    }).catch((error: unknown) => {
      if (!cancelled) setBoot({ kind: "fatal", error: normalizeError(error) });
    });

    return () => {
      cancelled = true;
      if (createdServices !== undefined) safelyDispose(createdServices);
    };
  }, []);

  if (boot.kind === "loading") {
    return (
      <main className="app-loading" aria-busy="true" aria-live="polite">
        <span className="app-loading__mark" aria-hidden="true">LC</span>
        <div>
          <h1>正在准备 LocalCoder</h1>
          <p>正在检查本地运行时与浏览器存储。</p>
        </div>
      </main>
    );
  }
  if (boot.kind === "fatal") throw boot.error;

  return (
    <AppServicesContext.Provider value={boot.services}>
      <ThemeProvider storage={boot.services.storage}>{children}</ThemeProvider>
    </AppServicesContext.Provider>
  );
}

function safelyDispose(services: AppServices): void {
  void services.supervisor.dispose().catch(() => undefined).finally(() => {
    services.storage.close();
  });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
