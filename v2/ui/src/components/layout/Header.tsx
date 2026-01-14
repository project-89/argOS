/**
 * Header component with simulation stats and command input
 */

import { useState } from "react";
import { Activity, Users, MapPin, Cpu, Send, Loader2 } from "lucide-react";
import { useSimulationStore } from "../../store/simulation";

interface HeaderProps {
  onSendCommand: (command: string) => void;
}

export function Header({ onSendCommand }: HeaderProps) {
  const { tick, agentCount, roomCount, systemCount, status } = useSimulationStore();
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || sending) return;

    setSending(true);
    try {
      onSendCommand(command);
      setCommand("");
    } finally {
      setSending(false);
    }
  };

  return (
    <header className="h-16 bg-argos-bg-secondary border-b border-argos-border flex items-center justify-between px-6">
      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-argos-god" />
          <span className="text-sm text-argos-text-secondary">Tick</span>
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {tick.toLocaleString()}
          </span>
        </div>

        <div className="h-4 w-px bg-argos-border" />

        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-argos-agent" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {agentCount}
          </span>
          <span className="text-sm text-argos-text-secondary">agents</span>
        </div>

        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-argos-world" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {roomCount}
          </span>
          <span className="text-sm text-argos-text-secondary">rooms</span>
        </div>

        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-argos-system" />
          <span className="text-sm font-mono font-semibold text-argos-text-primary">
            {systemCount}
          </span>
          <span className="text-sm text-argos-text-secondary">systems</span>
        </div>
      </div>

      {/* Command Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="God command..."
            disabled={status !== "connected"}
            className="w-80 px-4 py-2 bg-argos-bg-tertiary border border-argos-border rounded-lg text-sm text-argos-text-primary placeholder-argos-text-muted focus:outline-none focus:ring-2 focus:ring-argos-god/50 focus:border-argos-god/50 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!command.trim() || sending || status !== "connected"}
          className="p-2 bg-argos-god text-black rounded-lg hover:bg-argos-god-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </form>
    </header>
  );
}
