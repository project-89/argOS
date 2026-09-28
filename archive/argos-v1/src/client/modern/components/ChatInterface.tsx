import * as React from "react";
import { useState } from "react";
import {
  ServerMessage,
  AgentState,
  RoomState,
  AgentUpdateMessage,
  RoomUpdateMessage,
  ActionContent,
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

// Unified event types for both agent and room messages
export type EventType =
  | "speech"
  | "thought"
  | "perception"
  | "action"
  | "experience"
  | "appearance";

const EVENT_TYPES: Record<EventType, { label: string; color: string }> = {
  speech: { label: "Speech", color: "text-green-400" },
  action: { label: "Actions", color: "text-yellow-400" },
  thought: { label: "Thoughts", color: "text-purple-400" },
  perception: { label: "Perceptions", color: "text-gray-400" },
  experience: { label: "Experiences", color: "text-emerald-400" },
  appearance: { label: "Appearance", color: "text-blue-400" },
};

export function ChatInterface({
  selectedAgent,
  selectedRoom,
  agents,
  rooms,
  logs,
  onSendMessage,
}: ChatInterfaceProps) {
  const [message, setMessage] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<EventType>>(() => {
    const initialTypes = new Set<EventType>([
      "speech",
      "action",
      "thought",
      "perception",
      "experience",
    ]);
    console.log("Setting initial types:", Array.from(initialTypes));
    return initialTypes;
  });

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

  const toggleType = (type: EventType) => {
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

  // TODO: This is a bit of a mess, but it works for now
  const getMessageContent = (log: ServerMessage): string => {
    if (log.type === "AGENT_UPDATE" || log.type === "ROOM_UPDATE") {
      if (log.type === "ROOM_UPDATE") {
        const content = log.data.content;

        // Handle different content types
        if (typeof content === "object") {
          // Skip speak actions since we have speech events
          if ("action" in content && content.action !== "speak") {
            const actionContent = content as ActionContent;
            const actionStr = actionContent.action;
            const reasonStr = actionContent.reason
              ? `: ${actionContent.reason}`
              : "";
            return `${actionStr}${reasonStr}`;
          }

          // Handle speech messages
          if ("message" in content) {
            return content.message;
          }

          // Handle perception data
          if ("summary" in content) {
            const perceptionData = content as {
              summary: string;
              significance: string;
              analysis?: {
                keyObservations?: string[];
              };
            };

            // Just return the summary for perceptions
            return perceptionData.summary;
          }

          // Handle direct string content (like thoughts, observations)
          if ("content" in content && typeof content.content === "string") {
            return content.content;
          }

          // Handle narrative content
          if ("narrative" in content && typeof content.narrative === "string") {
            return content.narrative;
          }

          // Fallback for other object types - try to extract meaningful content
          if ("thought" in content) return content.thought;
          if ("result" in content) return content.result;

          // Last resort - stringify but with better formatting
          try {
            const cleanContent = { ...content };
            // Remove noisy fields
            delete cleanContent.timestamp;
            delete cleanContent.thoughtEntryId;
            delete cleanContent.agentName;
            delete cleanContent.context;
            return JSON.stringify(cleanContent, null, 2);
          } catch (e) {
            return String(content);
          }
        }

        // Direct string content
        return String(content);
      }
      // Handle AGENT_UPDATE content
      const content = log.data.content;

      // Handle appearance updates
      if (log.data.category === "appearance" && typeof content === "object") {
        const appearance = content as any;
        const changes: string[] = [];

        if (appearance.currentAction)
          changes.push(`${appearance.currentAction}`);
        if (appearance.facialExpression)
          changes.push(`expression: ${appearance.facialExpression}`);
        if (appearance.bodyLanguage)
          changes.push(`body language: ${appearance.bodyLanguage}`);
        if (appearance.socialCues)
          changes.push(`social cues: ${appearance.socialCues}`);

        return changes.join(" | ");
      }

      // Handle perception data - just show summary
      if (
        typeof content === "object" &&
        content !== null &&
        "summary" in content
      ) {
        const perceptionData = content as {
          summary: string;
          significance: string;
          analysis?: {
            keyObservations?: string[];
          };
        };

        // Format the perception data
        let formattedPerception = perceptionData.summary;

        // Add key observations if they exist
        if (perceptionData.analysis?.keyObservations?.length) {
          formattedPerception += "\nKey Observations:";
          perceptionData.analysis.keyObservations.forEach((obs) => {
            formattedPerception += `\n• ${obs}`;
          });
        }

        return formattedPerception;
      }

      // Handle other content types
      if (typeof content === "string") {
        return content;
      }

      try {
        const parsed =
          typeof content === "string" ? JSON.parse(content) : content;
        if (parsed && typeof parsed === "object" && "summary" in parsed) {
          return String(parsed.summary);
        }
      } catch (e) {
        // If JSON parsing fails, fall back to string conversion
      }

      return typeof content === "object"
        ? JSON.stringify(content)
        : String(content);
    }
    return "";
  };

  const getMessageType = (log: ServerMessage): EventType => {
    if (log.type === "AGENT_UPDATE") {
      return log.data.category.toLowerCase() as EventType;
    }
    if (log.type === "ROOM_UPDATE") {
      return log.data.type.toLowerCase() as EventType;
    }
    return "perception";
  };

  const getMessageColor = (type: EventType): string => {
    return EVENT_TYPES[type]?.color || "text-gray-400";
  };

  const filteredLogs = logs.filter(
    (log): log is AgentUpdateMessage | RoomUpdateMessage => {
      if (!(log.type === "AGENT_UPDATE" || log.type === "ROOM_UPDATE")) {
        return false;
      }

      const messageType = getMessageType(log);
      const isEnabled = selectedTypes.has(messageType);

      if (selectedAgent && log.type === "AGENT_UPDATE") {
        return log.channel.agent === selectedAgent && isEnabled;
      }

      if (selectedRoom && log.type === "ROOM_UPDATE") {
        return log.data.roomId === selectedRoom && isEnabled;
      }

      return false;
    }
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col border-b border-cyan-900/30">
        <div className="px-2 h-8 flex items-center justify-between border-b border-cyan-900/20">
          <h2 className="text-emerald-400">
            <span className="text-gray-500">MSG:</span> {getContextTitle()}
          </h2>
          <span className="text-xs text-gray-500">
            {selectedAgent ? "Direct Message" : "Room Chat"}
          </span>
        </div>

        <div className="px-2 h-8 flex items-center justify-start gap-2">
          <span className="text-[10px] text-gray-500">FILTER:</span>
          <div className="flex gap-1">
            {Object.entries(EVENT_TYPES).map(([type, { label }]) => (
              <button
                key={type}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  selectedTypes.has(type as EventType)
                    ? "bg-cyan-900/30 text-cyan-400"
                    : "bg-black/20 text-gray-500"
                }`}
                onClick={() => toggleType(type as EventType)}
              >
                {label}
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
              <span className={`text-xs ${getMessageColor(type)}`}>
                {EVENT_TYPES[type].label}
              </span>{" "}
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
