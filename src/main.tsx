import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearance, storedAppearance } from './components/ThemeMenu';
import './styles.css';

const { mode, theme } = storedAppearance();
applyAppearance(mode, theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
