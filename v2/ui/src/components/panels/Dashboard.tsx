/**
 * Dashboard panel - Force graph visualization with simulation controls
 */

import { Play, Wand2, X, ChevronUp } from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";
import { ForceGraphView } from "./ForceGraphView";
import { useState } from "react";

// Simulation preset definitions
const SIMULATION_PRESETS = [
  {
    id: "crossroads-inn",
    name: "Crossroads Inn",
    description: "A mystical tavern where travelers from different walks of life meet",
    color: "spirit",
    command: `Create "The Crossroads Inn" - a mystical tavern where paths converge.

Create three agents:
1. "Vera" - an elderly fortune teller with genuine mystical sight, speaks in riddles but kind
2. "Kael" - a young runaway noble seeking adventure, naive but brave
3. "Iron Jack" - a weathered bounty hunter, few words, strong moral code

Create a stimulus source "Mystic Hearth" - a magical fireplace that occasionally whispers prophecies.

Place everyone in the inn.`,
  },
  {
    id: "village-life",
    name: "Village Life",
    description: "A peaceful medieval village with daily routines and gossip",
    color: "agent",
    command: `Create a peaceful medieval village with:

Rooms:
- "Town Square" - the central gathering place
- "Bakery" - warm, smells of fresh bread
- "Tavern" - cozy with a warm hearth
- "Blacksmith" - hot and filled with the ring of metal

Agents:
1. "Ada" - a cheerful baker who loves her craft, early riser
2. "Bram" - a quiet but skilled blacksmith, protective of the village
3. "Clara" - the tavern keeper who knows everyone's secrets
4. "Old Tom" - the village elder, wise and respected

Place each agent in their appropriate location.`,
  },
  {
    id: "space-station",
    name: "Space Station",
    description: "A frontier space station with diverse crew and mysterious events",
    color: "system",
    command: `Create "Nexus Station" - a frontier space station at the edge of known space.

Rooms:
- "Command Deck" - the nerve center of the station
- "Crew Quarters" - living spaces for the crew
- "Cargo Bay" - storage and docking area
- "Medical Bay" - advanced medical facilities

Agents:
1. "Commander Chen" - stern but fair station commander, ex-military
2. "Dr. Vex" - alien medical officer, curious about humans
3. "Sparks" - eccentric engineer who talks to machines
4. "Nova" - mysterious drifter who recently arrived

Create a stimulus source "Station AI" that announces events and anomalies.`,
  },
  {
    id: "murder-mystery",
    name: "Murder Mystery",
    description: "A dinner party where someone has been murdered...",
    color: "god",
    command: `Create "Thornwood Manor" - a gothic mansion during a stormy night.

Rooms:
- "Grand Foyer" - impressive entrance with a grand staircase
- "Dining Room" - where the dinner party was held
- "Library" - filled with ancient books and secrets
- "Study" - the victim's private room

Agents:
1. "Lord Ashworth" - the host, hiding dark secrets
2. "Lady Ashworth" - his wife, not as innocent as she seems
3. "Detective Mills" - investigating the murder, sharp and observant
4. "Butler Jenkins" - knows everything that happens in the house

The victim was found in the library. Everyone is a suspect.`,
  },
];

export function Dashboard() {
  const { agentCount, roomCount } = useSimulationStore();
  const { sendGodCommand } = useSimulationBusContext();
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(true);

  const isEmptySimulation = agentCount === 0 && roomCount === 0;

  const handlePresetClick = (preset: (typeof SIMULATION_PRESETS)[number]) => {
    setLoadingPreset(preset.id);
    sendGodCommand(preset.command);
    // Hide presets after starting
    setTimeout(() => {
      setShowPresets(false);
      setLoadingPreset(null);
    }, 1000);
  };

  return (
    <div className="relative h-full w-full">
      {/* Force Graph View - Main visualization */}
      <ForceGraphView />

      {/* Simulation Presets Overlay - Show when empty or toggled */}
      {isEmptySimulation && showPresets && (
        <div className="absolute inset-0 flex items-center justify-center bg-argos-bg-primary/80 backdrop-blur-sm z-10">
          <div className="max-w-2xl w-full mx-4">
            <div className="bg-argos-bg-secondary border border-argos-border rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-argos-god/20 flex items-center justify-center">
                    <Wand2 className="w-5 h-5 text-argos-god" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-argos-text-primary">Create Simulation</h2>
                    <p className="text-xs text-argos-text-muted">Choose a preset or use God commands</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPresets(false)}
                  className="p-2 rounded-lg hover:bg-argos-bg-elevated text-argos-text-muted hover:text-argos-text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Presets Grid */}
              <div className="p-4 grid grid-cols-2 gap-3">
                {SIMULATION_PRESETS.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    onSelect={() => handlePresetClick(preset)}
                    isLoading={loadingPreset === preset.id}
                    isDisabled={loadingPreset !== null && loadingPreset !== preset.id}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed preset button - Show when simulation is empty but presets are hidden */}
      {isEmptySimulation && !showPresets && (
        <button
          onClick={() => setShowPresets(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-argos-god text-black rounded-full shadow-lg hover:bg-argos-god-light transition-all z-10"
        >
          <Wand2 className="w-4 h-4" />
          <span className="font-medium">Create Simulation</span>
          <ChevronUp className="w-4 h-4" />
        </button>
      )}

      {/* Stats overlay when simulation is running - pointer-events-none to not block graph */}
      {!isEmptySimulation && (
        <div className="absolute top-4 left-4 flex gap-2 z-10 pointer-events-none">
          <StatBadge label="Agents" value={agentCount} color="agent" />
          <StatBadge label="Rooms" value={roomCount} color="room" />
        </div>
      )}
    </div>
  );
}

// Stat badge component
function StatBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "agent" | "room" | "system";
}) {
  const colorClasses = {
    agent: "bg-argos-agent/20 text-argos-agent border-argos-agent/30",
    room: "bg-argos-world/20 text-argos-world border-argos-world/30",
    system: "bg-argos-system/20 text-argos-system border-argos-system/30",
  };

  return (
    <div
      className={`px-3 py-1.5 rounded-lg border backdrop-blur-sm ${colorClasses[color]}`}
    >
      <span className="text-xs opacity-80">{label}: </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

// Preset card component
function PresetCard({
  preset,
  onSelect,
  isLoading,
  isDisabled,
}: {
  preset: (typeof SIMULATION_PRESETS)[number];
  onSelect: () => void;
  isLoading?: boolean;
  isDisabled?: boolean;
}) {
  const colorClasses = {
    god: "border-argos-god/30 hover:border-argos-god/60 hover:bg-argos-god/5",
    spirit: "border-argos-spirit/30 hover:border-argos-spirit/60 hover:bg-argos-spirit/5",
    agent: "border-argos-agent/30 hover:border-argos-agent/60 hover:bg-argos-agent/5",
    system: "border-argos-system/30 hover:border-argos-system/60 hover:bg-argos-system/5",
  };

  const iconColors = {
    god: "text-argos-god",
    spirit: "text-argos-spirit",
    agent: "text-argos-agent",
    system: "text-argos-system",
  };

  const loadingColors = {
    god: "border-argos-god",
    spirit: "border-argos-spirit",
    agent: "border-argos-agent",
    system: "border-argos-system",
  };

  return (
    <button
      onClick={onSelect}
      disabled={isDisabled || isLoading}
      className={`p-4 rounded-lg border bg-argos-bg-tertiary transition-all text-left group relative ${
        isDisabled
          ? "opacity-50 cursor-not-allowed border-argos-border"
          : colorClasses[preset.color as keyof typeof colorClasses]
      } ${isLoading ? `border-2 ${loadingColors[preset.color as keyof typeof loadingColors]}` : ""}`}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-argos-bg-tertiary/80 rounded-lg">
          <div className={`w-6 h-6 border-2 border-t-transparent rounded-full animate-spin ${loadingColors[preset.color as keyof typeof loadingColors]}`} />
        </div>
      )}
      <div className="flex items-start justify-between mb-2">
        <h3 className={`font-semibold ${isDisabled ? "text-argos-text-muted" : "text-argos-text-primary"}`}>
          {preset.name}
        </h3>
        {!isLoading && !isDisabled && (
          <Play className={`w-4 h-4 ${iconColors[preset.color as keyof typeof iconColors]} opacity-0 group-hover:opacity-100 transition-opacity`} />
        )}
      </div>
      <p className={`text-sm ${isDisabled ? "text-argos-text-muted" : "text-argos-text-secondary"}`}>
        {preset.description}
      </p>
    </button>
  );
}
