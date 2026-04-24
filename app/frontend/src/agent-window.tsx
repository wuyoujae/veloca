import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AgentPalette, type AgentPaletteAnchor } from './agent-palette';
import './styles.css';

function getAgentWindowAnchor(): AgentPaletteAnchor {
  return {
    left: window.innerWidth / 2,
    mode: 'center',
    top: 16
  };
}

function AgentWindowApp(): JSX.Element {
  const [anchor, setAnchor] = useState<AgentPaletteAnchor>(() => getAgentWindowAnchor());

  useEffect(() => {
    document.documentElement.classList.add('agent-window-html');
    document.body.classList.add('agent-window-body');

    const updateAnchor = () => setAnchor(getAgentWindowAnchor());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void window.veloca?.agent.close();
      }
    };

    window.addEventListener('resize', updateAnchor);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div className="agent-window-shell">
      <AgentPalette position={anchor} visible />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AgentWindowApp />
  </React.StrictMode>
);
