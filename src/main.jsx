import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { startViewportTracking } from './lib/useViewport.js';
import { startPressFeedback } from './lib/pressFeedback.js';

// Publishes --vvh/--vvt/--kb so sheets and shells stay above the on-screen keyboard
startViewportTracking();
// One press animation for every button (scroll-safe on touch)
startPressFeedback();

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
