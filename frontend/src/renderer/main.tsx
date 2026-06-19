import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { initializeApi } from './api';
import { App } from './App';

// Resolve sidecar port before rendering (async in Tauri, no-op otherwise)
void initializeApi().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
