import { useMemo } from "react";
import { Link, Outlet } from "react-router-dom";

import { toRuntimeRailItem, toStorageBanner } from "../../features/runtimes/runtime-view-model.js";
import { RuntimeRail } from "../../features/runtimes/RuntimeRail.js";
import { useRuntimeRegistry } from "../../hooks/use-runtime-registry.js";
import { useStorageState } from "../../hooks/use-storage-state.js";
import { AppNav } from "./AppNav.js";
import { StorageStatus } from "./StorageStatus.js";

export function AppShell() {
  const capabilities = useRuntimeRegistry();
  const storageState = useStorageState();
  const runtimeItems = useMemo(() => capabilities.map(toRuntimeRailItem), [capabilities]);
  const storageBanner = useMemo(() => toStorageBanner(storageState), [storageState]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="app-header">
        <div className="app-header__inner">
          <Link className="app-brand" to="/" aria-label="LocalCoder 首页">
            <span className="app-brand__mark" aria-hidden="true">LC</span>
            <span>
              <strong>LocalCoder</strong>
              <small>local workbench</small>
            </span>
          </Link>
          <AppNav />
        </div>
      </header>
      <RuntimeRail items={runtimeItems} />
      <StorageStatus model={storageBanner} />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
