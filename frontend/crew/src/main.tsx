import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@cypresswatch/ui/tokens.css';

// Placeholder shell — replace with the real app.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>CypressWatch — Crew</h1>
  </StrictMode>,
);
