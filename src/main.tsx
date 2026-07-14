import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

;(globalThis as any).__SGMAHJONG_ENV__ = import.meta.env

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
