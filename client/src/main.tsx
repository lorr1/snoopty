import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    // eslint-disable-next-line no-console
    console.error('[snoopty] global error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    // eslint-disable-next-line no-console
    console.error('[snoopty] unhandled rejection', event.reason);
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
