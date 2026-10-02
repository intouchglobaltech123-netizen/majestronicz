import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// PLT-16: an image that can't load (offline, or a blocked host such as the
// Unsplash photos in the seed data) shows a neutral placeholder instead of the
// browser's broken-image icon. Components with their own fallback (ItemImage)
// still swap in their icon.
const IMAGE_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#f1f5f9"/><circle cx="25" cy="24" r="5" fill="#cbd5e1"/><path d="M14 46l12-14 8 9 6-7 10 12z" fill="#cbd5e1"/></svg>',
)}`;
window.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.src !== IMAGE_PLACEHOLDER) img.src = IMAGE_PLACEHOLDER;
}, true);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
