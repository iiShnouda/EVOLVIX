import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './skins.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
