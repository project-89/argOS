import * as React from "react";
import { useState } from "react";
import {
  ServerMessage,
  EventCategory,
  AgentState,
  RoomState,
  AgentUpdateMessage,
  RoomUpdateMessage,
} from "../../../types";
import { getTailwindColor } from "../../../utils/colors";

interface ChatInterfaceProps {
  selectedAgent: string | null;
  selectedRoom: string | null;
  agents: AgentState[];
  rooms: RoomState[];
  logs: ServerMessage[];
  onSendMessage: (message: string, room: string) => void;
}

export type EventType =
  | "speech"
  | "thought"
  | "perception"
  | "action"
  | "appearance"
  | "state"
  | "experience"
  | "agent";

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
    new Set(["speech", "action", "thought"])
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
      onSendMessage(message, selectedRoom || "");
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

  const getMessageContent = (log: ServerMessage): string => {
    if (log.type === "AGENT_UPDATE") {
      const { content } = log.data;
      if (typeof content === "object" && content !== null) {
        if ("action" in content) {
          return `${content.action}${
            "reason" in content && content.reason ? ` - ${content.reason}` : ""
          }`;
        }
        return JSON.stringify(content);
      }
      return String(content);
    }
    if (log.type === "ROOM_UPDATE") {
      const { content } = log.data;
      if (typeof content === "object" && content !== null) {
        if ("action" in content) {
          return `${content.action}${
            "reason" in content && content.reason ? ` - ${content.reason}` : ""
          }`;
        }
        return JSON.stringify(content);
      }
      return String(content);
    }
    return "";
  };

  const getMessageType = (log: ServerMessage): EventCategory | string => {
    if (log.type === "AGENT_UPDATE") {
      return log.data.category;
    }
    if (log.type === "ROOM_UPDATE") {
      return log.data.type;
    }
    return log.type.toLowerCase();
  };

  const getMessageColor = (type: string) => {
    switch (type) {
      case "thought":
        return "text-purple-400";
      case "experience":
        return "text-emerald-400";
      case "action":
        return "text-yellow-400";
      case "appearance":
        return "text-cyan-400";
      case "speech":
        return "text-green-400";
      default:
        return "text-gray-400";
    }
  };

  const filterTypes = [
    { id: "speech", label: "Speech" },
    { id: "action", label: "Actions" },
    { id: "thought", label: "Thoughts" },
    { id: "experience", label: "Experiences" },
    { id: "appearance", label: "Appearance" },
  ];

  const filteredLogs = logs.filter(
    (log): log is AgentUpdateMessage | RoomUpdateMessage => {
      if (!(log.type === "AGENT_UPDATE" || log.type === "ROOM_UPDATE")) {
        return false;
      }

      if (selectedAgent && log.type === "AGENT_UPDATE") {
        return (
          log.channel.agent === selectedAgent &&
          selectedTypes.has(log.data.category.toLowerCase())
        );
      }

      if (selectedRoom && log.type === "ROOM_UPDATE") {
        return selectedTypes.has(log.data.type.toLowerCase());
      }

      return false;
    }
  );

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
            {filterTypes.map((type) => (
              <button
                key={type.id}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  selectedTypes.has(type.id)
                    ? "bg-cyan-900/30 text-cyan-400"
                    : "bg-black/20 text-gray-500"
                }`}
                onClick={() => toggleType(type.id)}
              >
                {type.label}
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
            (log.type === "ROOM_UPDATE" && log.data.agentName) ||
            (log.type === "AGENT_UPDATE" &&
              agents.find((a) => a.id === log.channel.agent)?.name) ||
            "System";

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
