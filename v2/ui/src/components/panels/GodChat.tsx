/**
 * God AI Chat Drawer - Conversational interface with the God Agent
 */

import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, Sparkles, Bot, User } from "lucide-react";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";
import { useSimulationStore } from "../../store/simulation";
import type { GodResponseEvent, GodErrorEvent } from "../../types/events";

interface ChatMessage {
  id: string;
  role: "user" | "god";
  content: string;
  timestamp: number;
  thinking?: string;
  actions?: Array<{ tool: string; result?: unknown }>;
}

interface GodChatProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GodChat({ isOpen, onClose }: GodChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processedEvents = useRef<Set<number>>(new Set());

  const { sendGodCommand } = useSimulationBusContext();
  const { status, godEvents } = useSimulationStore();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Listen for god:response and god:error events
  useEffect(() => {
    if (!isThinking || godEvents.length === 0) return;

    // Find new response/error events
    for (const event of godEvents) {
      // Skip already processed events
      if (processedEvents.current.has(event.timestamp)) continue;

      if (event.type === "god:response") {
        const responseEvent = event as GodResponseEvent;

        // Format the response nicely
        let responseContent = responseEvent.thinking || "";

        // Add action summaries
        if (responseEvent.actions && responseEvent.actions.length > 0) {
          const actionSummary = responseEvent.actions
            .map((a) => `• ${a.tool}: ${JSON.stringify(a.result || "done").slice(0, 100)}`)
            .join("\n");
          responseContent += responseContent ? "\n\n" + actionSummary : actionSummary;
        }

        if (!responseContent) {
          responseContent = "Command executed successfully.";
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `god-${event.timestamp}`,
            role: "god",
            content: responseContent,
            timestamp: event.timestamp,
            thinking: responseEvent.thinking,
            actions: responseEvent.actions,
          },
        ]);

        processedEvents.current.add(event.timestamp);
        setIsThinking(false);
      } else if (event.type === "god:error") {
        const errorEvent = event as GodErrorEvent;

        setMessages((prev) => [
          ...prev,
          {
            id: `god-${event.timestamp}`,
            role: "god",
            content: `Error: ${errorEvent.error}`,
            timestamp: event.timestamp,
          },
        ]);

        processedEvents.current.add(event.timestamp);
        setIsThinking(false);
      }
    }
  }, [godEvents, isThinking]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinking || status !== "connected") return;

    const command = input.trim();
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: command,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);

    // Send to God AI
    sendGodCommand(command);

    // Fallback timeout - show message if no response after 30s
    setTimeout(() => {
      setIsThinking((current) => {
        if (current) {
          setMessages((prev) => [
            ...prev,
            {
              id: `god-${Date.now()}`,
              role: "god",
              content: "The God AI is taking longer than expected. Your command may still be processing...",
              timestamp: Date.now(),
            },
          ]);
          return false;
        }
        return current;
      });
    }, 30000);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-[400px] bg-argos-bg-secondary border-l border-argos-border z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-argos-god/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-argos-god" />
            </div>
            <div>
              <h2 className="font-semibold text-argos-text-primary">God AI</h2>
              <p className="text-xs text-argos-text-muted">The Architect</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-argos-bg-elevated text-argos-text-secondary hover:text-argos-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 rounded-full bg-argos-god/10 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-argos-god" />
              </div>
              <h3 className="text-lg font-medium text-argos-text-primary mb-2">
                Speak to the God AI
              </h3>
              <p className="text-sm text-argos-text-muted">
                Command the simulation. Create agents, rooms, trigger events, or
                shape the narrative.
              </p>
              <div className="mt-6 space-y-2 w-full">
                <SuggestionButton
                  onClick={() => setInput("Create a new agent named Maya, a curious explorer")}
                  text="Create an agent"
                />
                <SuggestionButton
                  onClick={() => setInput("Create a mysterious forest clearing")}
                  text="Create a room"
                />
                <SuggestionButton
                  onClick={() => setInput("Trigger a dramatic event - a stranger arrives")}
                  text="Trigger an event"
                />
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <ChatBubble key={msg.id} message={msg} />
            ))
          )}

          {isThinking && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-argos-god/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-argos-god" />
              </div>
              <div className="bg-argos-bg-tertiary rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-argos-text-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-argos-border bg-argos-bg-tertiary"
        >
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Command the simulation..."
              disabled={status !== "connected" || isThinking}
              className="flex-1 px-4 py-3 bg-argos-bg-primary border border-argos-border rounded-lg text-argos-text-primary placeholder-argos-text-muted focus:outline-none focus:ring-2 focus:ring-argos-god/50 focus:border-argos-god/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isThinking || status !== "connected"}
              className="px-4 py-3 bg-argos-god text-black rounded-lg hover:bg-argos-god-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isThinking ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// Chat bubble component
function ChatBubble({ message }: { message: ChatMessage }) {
  const isGod = message.role === "god";
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex items-start gap-3 ${isGod ? "" : "flex-row-reverse"}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isGod ? "bg-argos-god/20" : "bg-argos-agent/20"
        }`}
      >
        {isGod ? (
          <Sparkles className="w-4 h-4 text-argos-god" />
        ) : (
          <User className="w-4 h-4 text-argos-agent" />
        )}
      </div>
      <div
        className={`max-w-[280px] rounded-lg px-4 py-3 ${
          isGod
            ? "bg-argos-bg-tertiary"
            : "bg-argos-agent/20 border border-argos-agent/30"
        }`}
      >
        <p className="text-sm text-argos-text-primary whitespace-pre-wrap">
          {message.content}
        </p>
        <p className="text-xs text-argos-text-muted mt-1">{time}</p>
      </div>
    </div>
  );
}

// Suggestion button
function SuggestionButton({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2 text-sm text-left text-argos-text-secondary bg-argos-bg-tertiary border border-argos-border rounded-lg hover:bg-argos-bg-elevated hover:text-argos-text-primary transition-colors"
    >
      {text}
    </button>
  );
}
