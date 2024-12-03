import * as React from "react";
import { useState } from "react";
import { SimulationEvent } from "../../../types";
import { getTailwindColor } from "../../../utils/colors";

interface ChatInterfaceProps {
  selectedAgent: string | null;
  agents: any[];
  logs: SimulationEvent[];
  onSendMessage: (message: string) => void;
}

export function ChatInterface({
  selectedAgent,
  agents,
  logs,
  onSendMessage,
}: ChatInterfaceProps) {
  const [message, setMessage] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(["SPEECH", "THOUGHT", "WAIT", "MOVEMENT"])
  );

  const chatRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message);
      setMessage("");
    }
  };

  const toggleType = (type: string) => {
    const newTypes = new Set(selectedTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setSelectedTypes(newTypes);
  };

  const getContextTitle = () => {
    if (selectedAgent) {
      return `CHAT: ${selectedAgent}`;
    }
    return "CHAT: GOD MODE";
  };

  const filteredLogs = logs.filter((log) => {
    if (selectedAgent) {
      return (
        log.agentName === selectedAgent &&
        log.actionType &&
        selectedTypes.has(log.actionType)
      );
    }
    return log.actionType && selectedTypes.has(log.actionType);
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 h-8 flex items-center justify-between border-b border-cyan-900/30">
        <h2 className="text-emerald-400">
          <span className="text-gray-500">MSG:</span> {getContextTitle()}
        </h2>
        <div className="flex gap-2 text-xs">
          {["SPEECH", "THOUGHT", "WAIT", "MOVEMENT"].map((type) => (
            <button
              key={type}
              className={`px-2 py-0.5 rounded ${
                selectedTypes.has(type)
                  ? "bg-cyan-900/30 text-cyan-400"
                  : "bg-black/20 text-gray-500"
              }`}
              onClick={() => toggleType(type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-sm"
      >
        {filteredLogs.map((log, i) => (
          <div key={i} className="log-entry">
            <span className="text-gray-500">
              {new Date(log.timestamp).toLocaleTimeString()} »
            </span>{" "}
            {log.agentName && (
              <span className={getTailwindColor(log.agentName)}>
                [{log.agentName}]
              </span>
            )}{" "}
            <span className="text-gray-400">
              {log.data.message || log.data.thought || log.data.action}
            </span>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="p-2 border-t border-cyan-900/30">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              selectedAgent
                ? `Message ${selectedAgent}...`
                : "Enter god mode command..."
            }
            className="flex-1 bg-black/20 text-cyan-400 placeholder-gray-600 px-3 py-1 rounded font-mono text-sm border border-cyan-900/30 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded font-mono text-sm bg-black/30 text-emerald-400 border border-emerald-900/50"
          >
            SEND
          </button>
        </div>
      </form>
    </div>
  );
}
