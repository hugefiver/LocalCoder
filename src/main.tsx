import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { BrowserRouter, HashRouter } from 'react-router-dom';

import App from './App.tsx'
import { AppErrorFallback } from "@/components/app/AppErrorFallback";

import "./styles/foundations.css"
import "./styles/layout.css"

// GH Pages build uses HashRouter to avoid 404 on refresh.
// VITE_GITHUB_PAGES is injected at build time by CI.
const isGitHubPages = import.meta.env.VITE_GITHUB_PAGES === 'true' || import.meta.env.BASE_URL === './';

createRoot(document.getElementById('root')!).render(
  isGitHubPages ? (
    <HashRouter>
      <ErrorBoundary FallbackComponent={AppErrorFallback}>
        <App />
      </ErrorBoundary>
    </HashRouter>
  ) : (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ErrorBoundary FallbackComponent={AppErrorFallback}>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  )
)
