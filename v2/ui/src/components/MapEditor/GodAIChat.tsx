import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  role: "user" | "god" | "system";
  content: string;
  timestamp: Date;
}

interface GodAIChatProps {
  onSendMessage?: (message: string) => void;
  wsConnected?: boolean;
}

export function GodAIChat({ onSendMessage, wsConnected = false }: GodAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "system",
      content: "Welcome to ArgOS. Connect to a simulation to begin.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    if (onSendMessage) {
      onSendMessage(input.trim());
    } else {
      // Placeholder response when not connected
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${Date.now()}`,
            role: "god",
            content: "I am GodAI. Connect to a running simulation to interact with the world.",
            timestamp: new Date(),
          },
        ]);
      }, 500);
    }
  };

  const addGodMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: "god",
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const addSystemMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: "system",
        content,
        timestamp: new Date(),
      },
    ]);
  };

  // Expose methods for parent components
  (window as any).__godAIChat = { addGodMessage, addSystemMessage };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
            G
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">GodAI</h3>
            <p className="text-xs text-gray-400">
              {wsConnected ? "Connected" : "Disconnected"}
            </p>
          </div>
        </div>
        <div
          className={`w-2 h-2 rounded-full ${
            wsConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : msg.role === "god"
                  ? "bg-purple-900 text-purple-100 border border-purple-700"
                  : "bg-gray-700 text-gray-300 text-sm italic"
              }`}
            >
              {msg.role === "god" && (
                <div className="text-xs text-purple-400 mb-1 font-medium">
                  GodAI
                </div>
              )}
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <p className="text-xs opacity-50 mt-1">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to GodAI..."
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
