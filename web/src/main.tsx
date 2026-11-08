import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui';
import { telemetry } from './services/telemetry';
import './index.css';

// Initialize global structured telemetry and crash capture
telemetry.init();

// Conditionally initialize real-time debug telemetry only when VITE_DEBUG_TELEMETRY === 'true'
// Vite will completely tree-shake and omit this entire block in normal production releases!
if (import.meta.env.VITE_DEBUG_TELEMETRY === 'true') {
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
