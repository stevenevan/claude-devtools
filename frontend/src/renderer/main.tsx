import './index.css';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { initializeApi } from './api';
import { App } from './App';
import { useStore } from './store';

// Initialize the API client before rendering, then kick off the config
// preload before first paint so the Rust-confirmed value resolves while
// the skeleton shell (rendered by App) covers the first frame.
void initializeApi().then(() => {
  void useStore.getState().preloadConfig().catch(() => {});
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
