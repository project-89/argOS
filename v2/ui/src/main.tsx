import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SimulationBusProvider } from './contexts/SimulationBusContext'

// Note: StrictMode removed to prevent double WebSocket connections in development
// React StrictMode double-mounts components which causes connection issues with WebSockets
createRoot(document.getElementById('root')!).render(
  <SimulationBusProvider>
    <App />
  </SimulationBusProvider>,
)
