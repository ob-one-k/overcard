import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { startViewportTracking } from './lib/useViewport.js';

// Publishes --vvh/--vvt/--kb so sheets and shells stay above the on-screen keyboard
startViewportTracking();

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
