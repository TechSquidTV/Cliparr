import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AuthCompleteScreen from './components/AuthCompleteScreen.tsx';
import './index.css';

document.documentElement.classList.add('dark');

const isPlexAuthComplete = window.location.pathname.replace(/\/$/, '') === '/auth/plex/complete';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPlexAuthComplete ? <AuthCompleteScreen /> : <App />}
  </StrictMode>,
);
