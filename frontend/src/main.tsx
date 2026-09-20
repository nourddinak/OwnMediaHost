import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { DataRefreshProvider } from './context/DataRefreshContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <DataRefreshProvider>
          <App />
        </DataRefreshProvider>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>
);
