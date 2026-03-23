import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Apply persisted theme and zoom before first render to avoid flash
const savedTheme = localStorage.getItem('theme') ?? 'dark'
if (savedTheme === 'light') {
  document.documentElement.classList.add('light')
} else if (savedTheme === 'system') {
  if (!window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('light')
  }
}

const savedZoom = localStorage.getItem('zoom')
if (savedZoom) document.documentElement.style.zoom = savedZoom

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
