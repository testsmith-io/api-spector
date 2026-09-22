// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider, detectLocale } from './i18n';
import './index.css';

// Set <html lang> before first paint so it matches the chosen UI language.
document.documentElement.lang = detectLocale();

// Apply persisted theme and zoom before first render to avoid flash
const savedTheme = localStorage.getItem('theme') ?? 'dark';
if (savedTheme === 'light') {
  document.documentElement.classList.add('light');
} else if (savedTheme === 'system') {
  if (!window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('light');
  }
}

const savedZoom = localStorage.getItem('zoom');
if (savedZoom) window.electron.setZoomFactor(parseFloat(savedZoom));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
