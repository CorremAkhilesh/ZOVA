import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerServiceWorker } from './features/pwa/register';
import { finishPendingWipe } from './features/sync/wipe';
import { initI18n } from './lib/i18n';
import './styles/globals.css';

initI18n();
registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
const mount = root;

// Rare: only after a sign-out whose delete another tab blocked. Done before anything opens a database.
void finishPendingWipe()
  .catch(() => undefined)
  .then(() => {
    createRoot(mount).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
