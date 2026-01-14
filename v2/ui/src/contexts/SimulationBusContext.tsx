/**
 * SimulationBus Context Provider
 *
 * Ensures only one WebSocket connection exists for the entire app.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useSimulationBus, type SimulationBusActions } from "../hooks/useSimulationBus";

const SimulationBusContext = createContext<SimulationBusActions | null>(null);

export function SimulationBusProvider({ children }: { children: ReactNode }) {
  const bus = useSimulationBus({ autoConnect: true });

  return (
    <SimulationBusContext.Provider value={bus}>
      {children}
    </SimulationBusContext.Provider>
  );
}

export function useSimulationBusContext(): SimulationBusActions {
  const context = useContext(SimulationBusContext);
  if (!context) {
    throw new Error("useSimulationBusContext must be used within a SimulationBusProvider");
  }
  return context;
}
