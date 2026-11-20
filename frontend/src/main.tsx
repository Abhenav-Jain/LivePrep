import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './auth/AuthProvider';
import { AuthGate } from './AuthGate';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </React.StrictMode>
);
