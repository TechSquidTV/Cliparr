import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from '@tanstack/react-router';
import AuthCompleteScreen from './components/AuthCompleteScreen.tsx';
import {router} from './router.tsx';
import './index.css';

document.documentElement.classList.add('dark');

const isPlexAuthComplete = window.location.pathname.replace(/\/$/, '') === '/auth/plex/complete';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPlexAuthComplete ? <AuthCompleteScreen /> : <RouterProvider router={router} />}
  </StrictMode>,
);
