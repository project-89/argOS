/**
 * ArgOS UI - Main Application
 */

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useSimulationStore } from "./store/simulation";
import { useSimulationBusContext } from "./contexts/SimulationBusContext";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { Dashboard } from "./components/panels/Dashboard";
import { EventTimeline } from "./components/panels/EventTimeline";
import { AgentsPanel } from "./components/panels/AgentsPanel";
import { RoomsPanel } from "./components/panels/RoomsPanel";
import { SystemsPanel } from "./components/panels/SystemsPanel";
import { SpiritsPanel } from "./components/panels/SpiritsPanel";
import { LogsPanel } from "./components/panels/LogsPanel";
import { DaemonsPanel } from "./components/panels/DaemonsPanel";
import { GodChat } from "./components/panels/GodChat";

function App() {
  const { activePanel } = useSimulationStore();
  const { sendGodCommand } = useSimulationBusContext();
  const [chatOpen, setChatOpen] = useState(false);

  // Render the active panel
  const renderPanel = () => {
    switch (activePanel) {
      case "dashboard":
        return <Dashboard />;
      case "timeline":
        return <EventTimeline />;
      case "agents":
        return <AgentsPanel />;
      case "rooms":
        return <RoomsPanel />;
      case "spirits":
        return <SpiritsPanel />;
      case "systems":
        return <SystemsPanel />;
      case "logs":
        return <LogsPanel />;
      case "daemons":
        return <DaemonsPanel />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="h-screen w-screen flex bg-argos-bg-primary">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <Header onSendCommand={sendGodCommand} />

        {/* Panel Content */}
        <main className="flex-1 overflow-hidden bg-argos-bg-primary">
          {renderPanel()}
        </main>
      </div>

      {/* God Chat Drawer */}
      <GodChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Floating Chat Button */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-argos-god text-black rounded-full shadow-lg hover:bg-argos-god-light hover:scale-105 transition-all flex items-center justify-center z-30"
          title="Chat with God AI"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}

export default App;
