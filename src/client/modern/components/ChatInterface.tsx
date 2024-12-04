import * as React from "react";
import { useState } from "react";
import { ServerMessage } from "../../../types";
import { getTailwindColor } from "../../../utils/colors";

interface ChatInterfaceProps {
  selectedAgent: string | null;
  selectedRoom: string | null;
  agents: any[];
  rooms: any[];
  logs: ServerMessage[];
  onSendMessage: (message: string) => void;
}

export function ChatInterface({
  selectedAgent,
  selectedRoom,
  agents,
  rooms,
  logs,
  onSendMessage,
}: ChatInterfaceProps) {
  const [message, setMessage] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set([
      "SPEECH",
      "THOUGHT",
      "WAIT",
      "MOVEMENT",
      "STIMULUS",
      "PERCEPTION",
      "EXPERIENCE",
    ])
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
    if (selectedRoom) {
      const room = rooms.find((r) => r.id === selectedRoom);
      return `CHAT: ${room?.name || selectedRoom}`;
    }
    return "CHAT: GOD MODE";
  };

  const filteredLogs = logs.filter((log) => {
    if (selectedAgent && log.type === "AGENT_STATE") {
      return (
        log.data.agentName === selectedAgent &&
        log.data.category &&
        selectedTypes.has(log.data.category)
      );
    }
    return false;
  });

  const getMessageContent = (log: ServerMessage) => {
    if (log.type === "AGENT_STATE") {
      switch (log.data.category) {
        case "thought":
          return log.data.thought;
        case "action":
          return log.data.action?.type;
        case "appearance":
          return `${log.data.appearance?.currentAction || "Unknown action"}`;
      }
    }
    return null;
  };

  const getMessageType = (log: ServerMessage) => {
    if (log.type === "AGENT_STATE") {
      return log.data.category.toUpperCase();
    }
    return log.type;
  };

  const getMessageColor = (type: string) => {
    switch (type) {
      case "THOUGHT":
        return "text-purple-400";
      case "EXPERIENCE":
        return "text-emerald-400";
      case "PERCEPTION":
        return "text-cyan-400";
      case "STIMULUS":
        return "text-yellow-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col border-b border-cyan-900/30">
        {/* Top row: Metadata */}
        <div className="px-2 h-8 flex items-center justify-between border-b border-cyan-900/20">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">MSG:</span> {getContextTitle()}
          </h2>
          <span className="text-xs text-gray-500">
            {selectedAgent ? "Direct Message" : "Room Chat"}
          </span>
        </div>

        {/* Bottom row: Filters */}
        <div className="px-2 h-8 flex items-center justify-start gap-2">
          <span className="text-[10px] text-gray-500">FILTER:</span>
          <div className="flex gap-1">
            {[
              "SPEECH",
              "THOUGHT",
              "WAIT",
              "MOVEMENT",
              "STIMULUS",
              "PERCEPTION",
              "EXPERIENCE",
            ].map((type) => (
              <button
                key={type}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
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
      </div>

      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-sm"
      >
        {filteredLogs.map((log, i) => {
          const type = getMessageType(log);
          const content = getMessageContent(log);
          const agentName =
            (log.type === "AGENT_STATE" && log.data.agentName) ||
            agents.find((a) => a.id === selectedAgent)?.name ||
            "Unknown Agent";

          return (
            <div key={i} className="log-entry">
              <span className="text-gray-500">
                {new Date(log.timestamp).toLocaleTimeString()} »
              </span>{" "}
              {agentName !== "System" && (
                <span className={getTailwindColor(agentName)}>
                  [{agentName}]
                </span>
              )}{" "}
              <span className={`text-xs ${getMessageColor(type)}`}>{type}</span>{" "}
              <span className="text-gray-400">{content}</span>
            </div>
          );
        })}
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
