import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui';
import { telemetry } from './services/telemetry';
import './index.css';

// Initialize global structured telemetry and crash capture
telemetry.init();

// Initialize real-time debug telemetry when enabled at build time or runtime
const isDebugTelemetryActive =
  import.meta.env.VITE_DEBUG_TELEMETRY === 'true' ||
  (typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('debug') ||
     localStorage.getItem('cs_debug_telemetry') === 'true'));

if (isDebugTelemetryActive) {
  import('./debug/debugRecorder').then((m) => m.initDebugRecorder());
}

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] ServiceWorker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] ServiceWorker registration failed:', err);
      });
  };

  if (document.readyState === 'complete') {
    registerSW();
  } else {
    window.addEventListener('load', registerSW);
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
