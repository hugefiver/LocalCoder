import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/app/AppShell.js";
import { APP_MODE, ENABLE_EXECUTOR, ENABLE_PROBLEMS } from "./app-mode.js";

const ExecutorPage = lazy(async () => ({ default: (await import("../pages/ExecutorPage.js")).ExecutorPage }));
const HomePage = lazy(async () => ({ default: (await import("../pages/HomePage.js")).HomePage }));
const NotFoundPage = lazy(async () => ({ default: (await import("../pages/NotFoundPage.js")).NotFoundPage }));
const ProblemEditorPage = lazy(async () => ({ default: (await import("../pages/ProblemEditorPage.js")).ProblemEditorPage }));
const ProblemsPage = lazy(async () => ({ default: (await import("../pages/ProblemsPage.js")).ProblemsPage }));
const SubmissionsPage = lazy(async () => ({ default: (await import("../pages/SubmissionsPage.js")).SubmissionsPage }));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {APP_MODE === "all" ? <Route index element={<PageRoute Page={HomePage} />} /> : null}
        {APP_MODE === "executor" ? <Route index element={<PageRoute Page={ExecutorPage} />} /> : null}
        {APP_MODE === "problems" ? <Route index element={<PageRoute Page={ProblemsPage} />} /> : null}

        {ENABLE_EXECUTOR ? (
          <Route path="executor" element={APP_MODE === "executor" ? <Navigate to="/" replace /> : <PageRoute Page={ExecutorPage} />} />
        ) : (
          <Route path="executor" element={<PageRoute Page={NotFoundPage} />} />
        )}

        {ENABLE_PROBLEMS ? (
          <>
            <Route path="problems" element={APP_MODE === "problems" ? <Navigate to="/" replace /> : <PageRoute Page={ProblemsPage} />} />
            <Route path="problems/:id" element={<PageRoute Page={ProblemEditorPage} />} />
          </>
        ) : (
          <>
            <Route path="problems" element={<PageRoute Page={NotFoundPage} />} />
            <Route path="problems/:id" element={<PageRoute Page={NotFoundPage} />} />
          </>
        )}

        <Route path="submissions" element={<PageRoute Page={SubmissionsPage} />} />

        <Route path="*" element={<PageRoute Page={NotFoundPage} />} />
      </Route>
    </Routes>
  );
}

function PageRoute({ Page }: { Page: ComponentType }) {
  return <Suspense fallback={<PageLoading />}><Page /></Suspense>;
}

function PageLoading() {
  return <div aria-busy="true" className="app-loading" role="status">正在加载页面…</div>;
}
