/**
 * Sidebar navigation component
 */

import {
  LayoutDashboard,
  Users,
  MapPin,
  Sparkles,
  Ghost,
  Cpu,
  Clock,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import type { SimulationState } from "../../store/simulation";

const navItems: Array<{
  id: SimulationState["activePanel"];
  label: string;
  icon: typeof LayoutDashboard;
  color: string;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, color: "text-argos-god" },
  { id: "agents", label: "Agents", icon: Users, color: "text-argos-agent" },
  { id: "rooms", label: "Rooms", icon: MapPin, color: "text-argos-world" },
  { id: "spirits", label: "Spirits", icon: Sparkles, color: "text-argos-spirit" },
  { id: "daemons", label: "Daemons", icon: Ghost, color: "text-purple-400" },
  { id: "systems", label: "Systems", icon: Cpu, color: "text-argos-system" },
  { id: "timeline", label: "Timeline", icon: Clock, color: "text-argos-text-secondary" },
  { id: "logs", label: "Logs", icon: ScrollText, color: "text-gray-400" },
];

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen, activePanel, setActivePanel, status } =
    useSimulationStore();

  return (
    <aside
      className={`
        flex flex-col bg-argos-bg-secondary border-r border-argos-border
        transition-all duration-300 ease-in-out
        ${sidebarOpen ? "w-64" : "w-16"}
      `}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-argos-border">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-argos-god/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-argos-god" />
            </div>
            <span className="font-semibold text-argos-text-primary">ArgOS</span>
          </div>
        )}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg hover:bg-argos-bg-tertiary text-argos-text-secondary hover:text-argos-text-primary transition-colors"
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePanel === item.id;

            return (
              <li key={item.id}>
                <button
                  onClick={() => setActivePanel(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                    transition-colors
                    ${
                      isActive
                        ? "bg-argos-bg-tertiary text-argos-text-primary"
                        : "text-argos-text-secondary hover:bg-argos-bg-tertiary hover:text-argos-text-primary"
                    }
                  `}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className={`w-5 h-5 ${isActive ? item.color : ""}`} />
                  {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Connection Status */}
      <div className="p-4 border-t border-argos-border">
        <div className="flex items-center gap-3">
          {status === "connected" ? (
            <Wifi className="w-5 h-5 text-argos-status-success" />
          ) : (
            <WifiOff className="w-5 h-5 text-argos-status-error" />
          )}
          {sidebarOpen && (
            <div className="flex flex-col">
              <span className="text-xs text-argos-text-muted">Status</span>
              <span
                className={`text-sm font-medium ${
                  status === "connected"
                    ? "text-argos-status-success"
                    : status === "connecting"
                    ? "text-argos-status-warning"
                    : "text-argos-status-error"
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
