/**
 * main.tsx
 * Blazen Sim – React application entry point.
 * Mounts the root <App /> component into the #root DOM node.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
