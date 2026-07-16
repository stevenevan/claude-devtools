import './index.css';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import { initializeApi } from './api';
import { App } from './App';

// Initialize the API client before rendering
void initializeApi().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
