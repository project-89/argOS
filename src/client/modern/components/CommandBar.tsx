import * as React from "react";

interface CommandBarProps {
  isRunning: boolean;
  isConnected: boolean;
  onCommand: (command: string) => void;
  agents: any[];
}

export function CommandBar({
  isRunning,
  isConnected,
  onCommand,
  agents,
}: CommandBarProps) {
  const [elapsedTime, setElapsedTime] = React.useState(0);

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleCommand = (command: string) => {
    if (command === "STOP" || command === "RESET") {
      setElapsedTime(0);
    }
    onCommand(command);
  };

  return (
    <div className="h-12 border-b border-cyan-900/30 bg-black/20 flex items-center justify-between px-4">
      {/* Left: Primary Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleCommand(isRunning ? "STOP" : "START")}
            disabled={!isConnected}
            className={`px-3 py-1 rounded font-mono text-sm transition-all duration-200 ${
              !isConnected
                ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                : isRunning
                ? "bg-black/30 text-yellow-400 border border-yellow-900/50 hover:bg-yellow-900/20 hover:border-yellow-700/50"
                : "bg-black/30 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/20 hover:border-emerald-700/50"
            } ${isRunning ? "animate-pulse-slow" : ""}`}
          >
            <span className="inline-flex items-center">
              {isRunning ? (
                <>
                  <span className="mr-1">■</span>
                  <span>PAUSE</span>
                </>
              ) : (
                <>
                  <span className="mr-1">►</span>
                  <span>START</span>
                </>
              )}
            </span>
          </button>
          <button
            onClick={() => handleCommand("STOP")}
            disabled={!isConnected}
            className={`px-3 py-1 rounded font-mono text-sm ${
              !isConnected
                ? "bg-gray-800 text-gray-600"
                : "bg-black/30 text-red-400 border border-red-900/50"
            }`}
          >
            ◼ STOP
          </button>
          <button
            onClick={() => handleCommand("RESET")}
            disabled={!isConnected}
            className={`px-3 py-1 rounded font-mono text-sm ${
              !isConnected
                ? "bg-gray-800 text-gray-600"
                : "bg-black/30 text-orange-400 border border-orange-900/50"
            }`}
          >
            ⟲ RESET
          </button>
        </div>

        {/* Time Controls */}
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded font-mono text-xs bg-black/30 text-cyan-400 border border-cyan-900/50"
            onClick={() => {
              /* TODO: Implement speed control */
            }}
          >
            0.5×
          </button>
          <button className="px-2 py-1 rounded font-mono text-xs bg-black/30 text-cyan-400 border border-cyan-900/50">
            1×
          </button>
          <button className="px-2 py-1 rounded font-mono text-xs bg-black/30 text-cyan-400 border border-cyan-900/50">
            2×
          </button>
        </div>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-xl mx-4">
        <input
          type="text"
          placeholder="Search agents, events, or use commands..."
          className="w-full px-3 py-1 rounded font-mono text-sm bg-black/30 text-cyan-400 border border-cyan-900/50 focus:outline-none focus:border-cyan-500"
        />
      </div>

      {/* Right: Status */}
      <div className="flex items-center space-x-4">
        <div className="text-sm font-mono">
          <span className="text-gray-500">Agents:</span>{" "}
          <span className="text-cyan-400">{agents.length}</span>
        </div>
        <div className="text-sm font-mono">
          <span className="text-gray-500">Time:</span>{" "}
          <span className="text-cyan-400">{formatTime(elapsedTime)}</span>
        </div>
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-emerald-400 animate-pulse-slow" : "bg-red-500"
          }`}
        />
      </div>
    </div>
  );
}
