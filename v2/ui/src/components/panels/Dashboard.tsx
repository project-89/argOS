/**
 * Dashboard panel - Force graph visualization with simulation controls
 */

import {
  Play,
  Wand2,
  X,
  ChevronUp,
  Sparkles,
  Ghost,
  Users,
  MapPin,
  Cpu,
  BookOpenText,
  ScrollText,
} from "lucide-react";
import { useSimulationStore } from "../../store/simulation";
import { useSimulationBusContext } from "../../contexts/SimulationBusContext";
import { ForceGraphView } from "./ForceGraphView";
import { useMemo, useState, type ReactNode } from "react";

// Simulation preset definitions
const SIMULATION_PRESETS = [
  {
    id: "crossroads-inn",
    name: "Crossroads Inn",
    description: "A mystical tavern where travelers from different walks of life meet",
    color: "spirit",
    command: `Create "The Crossroads Inn" - a mystical tavern where paths converge.

Rooms:
- "Main Hall" - a warm tavern hall with a crackling hearth and wooden tables
- "Kitchen" - a busy kitchen with pots bubbling and herbs hanging
- "Courtyard" - a quiet courtyard under open sky with a stone well

Agents:
1. "Vera" - role: fortune teller. An elderly mystic with genuine prophetic sight, speaks in riddles but kind. Place in Main Hall.
2. "Kael" - role: runaway noble. A young noble who fled his family, naive but brave. Place in Main Hall.
3. "Iron Jack" - role: bounty hunter. A weathered tracker with a scarred face and few words. Place in Courtyard.

Objects:
- "Bread Loaf" in Kitchen with traits: food, examinable, takeable
- "Ale Mug" in Main Hall with traits: drinkable, examinable
- "Worn Map" in Main Hall with traits: examinable, takeable
- "Iron Dagger" in Courtyard with traits: examinable, takeable

Create a stimulus source "Mystic Hearth" in Main Hall - a magical fireplace that occasionally whispers prophecies.`,
  },
  {
    id: "village-life",
    name: "Village Life",
    description: "A peaceful medieval village with daily routines and gossip",
    color: "agent",
    command: `Create a peaceful medieval village.

Rooms:
- "Town Square" - the central gathering place with a fountain
- "Bakery" - warm, smells of fresh bread
- "Tavern" - cozy with a warm hearth and tables
- "Blacksmith" - hot forge filled with the ring of metal

Agents:
1. "Ada" - role: baker. A cheerful baker who loves her craft, early riser. Place in Bakery.
2. "Bram" - role: blacksmith. A quiet but skilled blacksmith, protective of the village. Place in Blacksmith.
3. "Clara" - role: innkeeper. The tavern keeper who knows everyone's secrets. Place in Tavern.
4. "Old Tom" - role: scholar. The village elder, wise and respected. Place in Town Square.

Objects:
- "Fresh Bread" in Bakery with traits: food, examinable, takeable
- "Ale Barrel" in Tavern with traits: drinkable, examinable
- "Iron Sword" in Blacksmith with traits: examinable, takeable
- "Ancient Tome" in Town Square with traits: examinable, takeable
- "Warm Stew" in Tavern with traits: food, examinable`,
  },
  {
    id: "space-station",
    name: "Space Station",
    description: "A frontier space station with diverse crew and mysterious events",
    color: "system",
    command: `Create "Nexus Station" - a frontier space station at the edge of known space.

Rooms:
- "Command Deck" - the nerve center of the station with holographic displays
- "Crew Quarters" - living spaces for the crew with bunks and lockers
- "Cargo Bay" - storage and docking area, dimly lit
- "Medical Bay" - advanced medical facilities, sterile and bright

Agents:
1. "Commander Chen" - role: guard. Stern but fair station commander, ex-military. Place in Command Deck.
2. "Dr. Vex" - role: scholar. Alien medical officer, curious about humans. Place in Medical Bay.
3. "Sparks" - role: worker. Eccentric engineer who talks to machines. Place in Cargo Bay.
4. "Nova" - role: merchant. Mysterious drifter who recently arrived, trades in rare goods. Place in Crew Quarters.

Objects:
- "Ration Pack" in Crew Quarters with traits: food, examinable, takeable
- "Medical Scanner" in Medical Bay with traits: examinable
- "Data Tablet" in Command Deck with traits: examinable, takeable
- "Cargo Manifest" in Cargo Bay with traits: examinable, takeable

Create a stimulus source "Station AI" in Command Deck that announces events and anomalies.`,
  },
  {
    id: "murder-mystery",
    name: "Murder Mystery",
    description: "A dinner party where someone has been murdered...",
    color: "god",
    command: `Create "Thornwood Manor" - a gothic mansion during a stormy night.

Rooms:
- "Grand Foyer" - impressive entrance with a grand staircase, cold drafts
- "Dining Room" - where the dinner party was held, table still set
- "Library" - filled with ancient books, the crime scene
- "Study" - the victim's private room, locked from inside

Agents:
1. "Lord Ashworth" - role: merchant. The host, hiding dark secrets. Place in Dining Room.
2. "Lady Ashworth" - role: scholar. His wife, not as innocent as she seems. Place in Grand Foyer.
3. "Detective Mills" - role: guard. Investigating the murder, sharp and observant. Place in Library.
4. "Butler Jenkins" - role: innkeeper. Knows everything that happens in the house. Place in Grand Foyer.

Objects:
- "Bloody Letter Opener" in Library with traits: examinable, takeable
- "Torn Letter" in Study with traits: examinable, takeable
- "Wine Glass" in Dining Room with traits: drinkable, examinable
- "Ancient Ledger" in Library with traits: examinable, takeable
- "Silver Candelabra" in Grand Foyer with traits: examinable

The victim was found in the library. Everyone is a suspect.`,
  },
];

type LiveFeedItem = {
  id: string;
  title: string;
  body: string;
  meta?: string;
  timestamp?: number;
  onOpen?: () => void;
};

export function Dashboard() {
  const {
    agentCount,
    entityCount,
    roomCount,
    systemCount,
    spiritCount,
    daemonCount,
    simulationStatus,
    spiritEvents,
    systemLogs,
    agentEvents,
    roomEvents,
    daemonEvents,
    daemons,
    narrativeLog,
    setActivePanel,
    setSelectedAgent,
    setSelectedRoom,
    setSelectedSystem,
    setSelectedSpirit,
    setSelectedDaemon,
  } = useSimulationStore();
  const { sendGodCommand, inject } = useSimulationBusContext();
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(true);

  const isEmptySimulation = agentCount === 0 && roomCount === 0;

  const spiritFeed = useMemo<LiveFeedItem[]>(() => {
    const items: LiveFeedItem[] = [];
    for (const event of spiritEvents) {
      const data = event as any;
      if (event.type === "spirit:observe") {
        const spiritName = data.spiritName || "Spirit";
        items.push({
          id: `spirit-observe-${event.timestamp}-${spiritName}`,
          title: `${spiritName} observed`,
          body: data.observation || data.content || "Observation recorded.",
          meta: Array.isArray(data.recommendations) && data.recommendations.length > 0
            ? `${data.recommendations.length} recommendations`
            : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedSpirit(spiritName);
            setActivePanel("spirits");
          },
        });
      } else if (event.type === "spirit:message") {
        const messageType = String(data.messageType || "message").replace(/_/g, " ");
        const spiritName =
          data.spiritName ||
          data.spirit ||
          (data.messageType === "story" ? "The Narrator" : "Spirit");
        items.push({
          id: `spirit-message-${event.timestamp}-${spiritName}-${messageType}`,
          title:
            data.messageType === "story"
              ? `${spiritName} narrative beat`
              : `${spiritName} ${messageType}`,
          body: data.content || data.subject || "Message delivered.",
          meta: data.priority ? `priority: ${data.priority}` : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            if (spiritName) {
              setSelectedSpirit(spiritName);
            }
            setActivePanel("spirits");
          },
        });
      } else if (event.type === "spirit:intervention") {
        const spiritName = data.spiritName || "Spirit";
        const action = data.action ? String(data.action).replace(/_/g, " ") : "intervened";
        items.push({
          id: `spirit-intervention-${event.timestamp}-${spiritName}`,
          title: `${spiritName} ${action}`,
          body: data.reason || "Intervention recorded.",
          meta: data.target ? `target: ${data.target}` : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedSpirit(spiritName);
            setActivePanel("spirits");
          },
        });
      }
      if (items.length >= 8) break;
    }
    return items;
  }, [spiritEvents, setActivePanel, setSelectedSpirit]);

  const daemonNarrativeFeed = useMemo<LiveFeedItem[]>(() => {
    const items: LiveFeedItem[] = [];
    const daemonStories = [...daemons]
      .filter((daemon) => Boolean(daemon.latestPovStory))
      .sort(
        (a, b) =>
          Math.max(b.lastReport, b.lastObservation, b.lastWhisper) -
          Math.max(a.lastReport, a.lastObservation, a.lastWhisper)
      );

    for (const daemon of daemonStories.slice(0, 4)) {
      items.push({
        id: `daemon-story-${daemon.agentEid}`,
        title: `${daemon.agentName} POV`,
        body: daemon.latestPovStory || "Narrative pending",
        meta: daemon.arcStatus
          ? `arc: ${daemon.arcStatus}${daemon.arcTension !== undefined ? ` (${Math.round(daemon.arcTension * 100)}% tension)` : ""}`
          : undefined,
        timestamp: Math.max(daemon.lastReport, daemon.lastObservation, daemon.lastWhisper),
        onOpen: () => {
          setSelectedDaemon(daemon.agentName);
          setActivePanel("daemons");
        },
      });
    }

    for (const event of daemonEvents) {
      const data = event as any;
      if (event.type === "daemon:observe") {
        items.push({
          id: `daemon-observe-${event.timestamp}-${data.agentName || "daemon"}`,
          title: `${data.agentName || "Daemon"} observed`,
          body: data.observation || "Observation logged.",
          timestamp: event.timestamp,
          onOpen: () => {
            if (data.agentName) {
              setSelectedDaemon(data.agentName);
            }
            setActivePanel("daemons");
          },
        });
      } else if (event.type === "daemon:whisper") {
        items.push({
          id: `daemon-whisper-${event.timestamp}-${data.agentName || "daemon"}`,
          title: `${data.agentName || "Daemon"} whisper`,
          body: data.content || "Whisper delivered.",
          meta: data.whisperType ? String(data.whisperType).replace(/_/g, " ") : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            if (data.agentName) {
              setSelectedDaemon(data.agentName);
            }
            setActivePanel("daemons");
          },
        });
      } else if (event.type === "daemon:report") {
        items.push({
          id: `daemon-report-${event.timestamp}-${data.agentName || "daemon"}`,
          title: `${data.agentName || "Daemon"} report`,
          body: data.summary || data.subject || "Report filed.",
          meta: data.urgency ? `urgency: ${data.urgency}` : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            if (data.agentName) {
              setSelectedDaemon(data.agentName);
            }
            setActivePanel("daemons");
          },
        });
      } else if (event.type === "daemon:nudge") {
        items.push({
          id: `daemon-nudge-${event.timestamp}-${data.agentName || "daemon"}`,
          title: `${data.agentName || "Daemon"} nudge`,
          body: data.action || data.reason || "Nudge dispatched.",
          meta: data.nudgeType ? String(data.nudgeType).replace(/_/g, " ") : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            if (data.agentName) {
              setSelectedDaemon(data.agentName);
            }
            setActivePanel("daemons");
          },
        });
      }
      if (items.length >= 8) break;
    }

    return items
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 8);
  }, [daemons, daemonEvents, setActivePanel, setSelectedDaemon]);

  const npcActionFeed = useMemo<LiveFeedItem[]>(() => {
    const items: LiveFeedItem[] = [];
    for (const event of agentEvents) {
      const data = event as any;
      if (event.type === "agent:action") {
        const agentName = data.agentName || "Agent";
        const action = String(data.action || "acted").replace(/_/g, " ");
        items.push({
          id: `agent-action-${event.timestamp}-${agentName}-${action}`,
          title: `${agentName} ${action}`,
          body:
            data.content ||
            data.result ||
            (data.target ? `Target: ${data.target}` : "Action executed."),
          meta:
            typeof data.action === "string" && data.action.includes("move")
              ? "movement"
              : data.target
              ? `target: ${data.target}`
              : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedAgent(agentName);
            setActivePanel("agents");
          },
        });
      } else if (event.type === "agent:think") {
        const agentName = data.agentName || "Agent";
        items.push({
          id: `agent-think-${event.timestamp}-${agentName}`,
          title: `${agentName} thought`,
          body: data.thought || "Thought logged.",
          meta: data.thoughtType ? String(data.thoughtType) : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedAgent(agentName);
            setActivePanel("agents");
          },
        });
      } else if (event.type === "agent:emotion") {
        const agentName = data.agentName || "Agent";
        const intensity =
          typeof data.intensity === "number"
            ? `${Math.round(data.intensity * 100)}%`
            : undefined;
        items.push({
          id: `agent-emotion-${event.timestamp}-${agentName}`,
          title: `${agentName} emotion shift`,
          body: data.emotion ? `${data.emotion}` : "Emotion updated.",
          meta: intensity,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedAgent(agentName);
            setActivePanel("agents");
          },
        });
      }
      if (items.length >= 8) break;
    }
    return items;
  }, [agentEvents, setActivePanel, setSelectedAgent]);

  const roomFeed = useMemo<LiveFeedItem[]>(() => {
    const items: LiveFeedItem[] = [];
    for (const event of roomEvents) {
      const data = event as any;
      if (event.type === "room:activity") {
        const roomName = data.roomName || "Room";
        const activityType = data.activityType
          ? String(data.activityType).replace(/_/g, " ")
          : "activity";
        items.push({
          id: `room-activity-${event.timestamp}-${roomName}-${activityType}`,
          title: `${roomName} ${activityType}`,
          body: data.content || "Room activity detected.",
          meta: data.actor ? `actor: ${data.actor}` : undefined,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedRoom(roomName);
            setActivePanel("rooms");
          },
        });
      } else if (event.type === "room:state") {
        const roomName = data.roomName || "Room";
        const occupants = Array.isArray(data.occupants) ? data.occupants.length : 0;
        items.push({
          id: `room-state-${event.timestamp}-${roomName}`,
          title: `${roomName} state`,
          body: data.ambience || "State snapshot updated.",
          meta: `${occupants} occupants`,
          timestamp: event.timestamp,
          onOpen: () => {
            setSelectedRoom(roomName);
            setActivePanel("rooms");
          },
        });
      }
      if (items.length >= 8) break;
    }
    return items;
  }, [roomEvents, setActivePanel, setSelectedRoom]);

  const systemFeed = useMemo<LiveFeedItem[]>(() => {
    const latestLogs: Array<{
      systemName: string;
      log: {
        id: string;
        timestamp: number;
        type: "created" | "executed" | "error" | "log";
        message: string;
        duration?: number;
        entitiesProcessed?: number;
        tick?: number;
      };
    }> = [];

    for (const [systemName, logs] of Object.entries(systemLogs)) {
      for (const log of logs.slice(0, 4)) {
        latestLogs.push({ systemName, log });
      }
    }

    latestLogs.sort((a, b) => b.log.timestamp - a.log.timestamp);

    return latestLogs.slice(0, 8).map(({ systemName, log }) => ({
      id: log.id,
      title: `${systemName} ${log.type}`,
      body: log.message || "System event recorded.",
      meta:
        log.duration !== undefined
          ? `${log.duration.toFixed(1)}ms`
          : log.entitiesProcessed !== undefined
          ? `${log.entitiesProcessed} entities`
          : log.tick !== undefined
          ? `tick ${log.tick}`
          : undefined,
      timestamp: log.timestamp,
      onOpen: () => {
        setSelectedSystem(systemName);
        setActivePanel("systems");
      },
    }));
  }, [systemLogs, setActivePanel, setSelectedSystem]);

  const handlePresetClick = (preset: (typeof SIMULATION_PRESETS)[number]) => {
    setLoadingPreset(preset.id);
    sendGodCommand(preset.command);
    // Ensure the dev server unpauses so the deterministic ECS substrate runs
    inject({ type: "inject:simulation_resume" });
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
        <div className="absolute top-4 left-4 flex flex-wrap gap-2 max-w-[60vw] z-10 pointer-events-none">
          <StatBadge label="Agents" value={agentCount} color="agent" />
          <StatBadge label="Entities" value={entityCount} color="system" />
          <StatBadge label="Rooms" value={roomCount} color="room" />
          <StatBadge label="Systems" value={systemCount} color="system" />
          <StatBadge label="Spirits" value={spiritCount} color="spirit" />
          <StatBadge label="Daemons" value={daemonCount} color="daemon" />
          <SimulationStatusBadge status={simulationStatus} />
        </div>
      )}

      {/* Live simulation streams */}
      {!isEmptySimulation && (
        <div className="absolute top-4 right-4 bottom-4 w-[24rem] z-10 pointer-events-none hidden xl:block">
          <div className="h-full overflow-y-auto pr-1 space-y-3 pointer-events-auto">
            {/* Narrative Log - Story prose from The Narrator */}
            {narrativeLog.length > 0 && (
              <div className="panel bg-argos-bg-secondary/95 backdrop-blur-sm border-argos-border/80">
                <div className="panel-header flex items-center justify-between px-3 py-2 border-b border-argos-border/60">
                  <div className="flex items-center gap-2">
                    <ScrollText className="w-4 h-4 text-argos-god" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-argos-text-secondary">
                      Story
                    </span>
                    <span className="text-xs text-argos-text-muted">({narrativeLog.length})</span>
                  </div>
                </div>
                <div className="panel-content p-3 max-h-48 overflow-y-auto space-y-2">
                  {narrativeLog.slice(-5).reverse().map((entry, i) => (
                    <p key={`narrative-${entry.timestamp}-${i}`} className="text-xs text-argos-text-primary leading-relaxed italic">
                      {entry.content}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <LiveFeedCard
              title="Spirit Cognition"
              icon={<Sparkles className="w-4 h-4 text-argos-spirit" />}
              count={spiritEvents.length}
              onOpenPanel={() => setActivePanel("spirits")}
              items={spiritFeed}
              emptyMessage="No spirit events yet."
            />
            <LiveFeedCard
              title="Daemon Narratives"
              icon={<Ghost className="w-4 h-4 text-argos-agent" />}
              count={daemonEvents.length}
              onOpenPanel={() => setActivePanel("daemons")}
              items={daemonNarrativeFeed}
              emptyMessage="Daemon POV and reports will appear here."
            />
            <LiveFeedCard
              title="NPC Actions"
              icon={<Users className="w-4 h-4 text-argos-agent" />}
              count={agentEvents.length}
              onOpenPanel={() => setActivePanel("agents")}
              items={npcActionFeed}
              emptyMessage="Agent actions and thoughts will stream here."
            />
            <LiveFeedCard
              title="Room Streams"
              icon={<MapPin className="w-4 h-4 text-argos-world" />}
              count={roomEvents.length}
              onOpenPanel={() => setActivePanel("rooms")}
              items={roomFeed}
              emptyMessage="Room activity has not started yet."
            />
            <LiveFeedCard
              title="System Runtime"
              icon={<Cpu className="w-4 h-4 text-argos-system" />}
              count={Object.keys(systemLogs).length}
              onOpenPanel={() => setActivePanel("systems")}
              items={systemFeed}
              emptyMessage="System logs will appear here when systems execute."
            />
            <div className="panel bg-argos-bg-secondary/95 backdrop-blur-sm border-argos-border/80">
              <div className="panel-content p-3">
                <button
                  onClick={() => setActivePanel("timeline")}
                  className="w-full text-xs font-semibold uppercase tracking-wide text-argos-text-secondary hover:text-argos-text-primary transition-colors flex items-center justify-center gap-2"
                >
                  <BookOpenText className="w-4 h-4" />
                  Open Full Timeline
                </button>
              </div>
            </div>
          </div>
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
  color: "agent" | "room" | "system" | "spirit" | "daemon";
}) {
  const colorClasses = {
    agent: "bg-argos-agent/20 text-argos-agent border-argos-agent/30",
    room: "bg-argos-world/20 text-argos-world border-argos-world/30",
    system: "bg-argos-system/20 text-argos-system border-argos-system/30",
    spirit: "bg-argos-spirit/20 text-argos-spirit border-argos-spirit/30",
    daemon: "bg-argos-agent/20 text-argos-agent-light border-argos-agent/30",
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

function SimulationStatusBadge({ status }: { status: "running" | "paused" | "stopped" }) {
  const colorClasses = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    paused: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    stopped: "bg-argos-bg-secondary/80 text-argos-text-muted border-argos-border",
  };

  return (
    <div className={`px-3 py-1.5 rounded-lg border backdrop-blur-sm ${colorClasses[status]}`}>
      <span className="text-xs uppercase tracking-wide font-semibold">{status}</span>
    </div>
  );
}

function LiveFeedCard({
  title,
  icon,
  items,
  emptyMessage,
  count,
  onOpenPanel,
}: {
  title: string;
  icon: ReactNode;
  items: LiveFeedItem[];
  emptyMessage: string;
  count: number;
  onOpenPanel?: () => void;
}) {
  return (
    <div className="panel bg-argos-bg-secondary/95 backdrop-blur-sm border-argos-border/80 shadow-lg">
      <div className="panel-header p-3">
        <span className="panel-title flex items-center gap-2 !text-xs">
          {icon}
          {title}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-argos-text-muted">{count}</span>
          {onOpenPanel && (
            <button
              onClick={onOpenPanel}
              className="text-[11px] uppercase tracking-wide text-argos-text-secondary hover:text-argos-text-primary transition-colors"
            >
              Open
            </button>
          )}
        </div>
      </div>
      <div className="panel-content p-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-argos-text-muted italic">{emptyMessage}</p>
        ) : (
          items.slice(0, 4).map((item) => (
            <LiveFeedRow key={item.id} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function LiveFeedRow({ item }: { item: LiveFeedItem }) {
  if (item.onOpen) {
    return (
      <button
        onClick={item.onOpen}
        className="w-full text-left p-2 rounded-lg bg-argos-bg-tertiary/70 hover:bg-argos-bg-tertiary transition-colors border border-transparent hover:border-argos-border"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-argos-text-primary leading-tight">{item.title}</p>
          {item.timestamp && (
            <span className="text-[10px] text-argos-text-muted whitespace-nowrap">
              {formatRelativeTime(item.timestamp)}
            </span>
          )}
        </div>
        <p className="text-xs text-argos-text-secondary mt-1 line-clamp-2 leading-relaxed">{item.body}</p>
        {item.meta && <p className="text-[10px] text-argos-text-muted mt-1 uppercase tracking-wide">{item.meta}</p>}
      </button>
    );
  }

  return (
    <div className="p-2 rounded-lg bg-argos-bg-tertiary/70">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-argos-text-primary leading-tight">{item.title}</p>
        {item.timestamp && (
          <span className="text-[10px] text-argos-text-muted whitespace-nowrap">
            {formatRelativeTime(item.timestamp)}
          </span>
        )}
      </div>
      <p className="text-xs text-argos-text-secondary mt-1 line-clamp-2 leading-relaxed">{item.body}</p>
      {item.meta && <p className="text-[10px] text-argos-text-muted mt-1 uppercase tracking-wide">{item.meta}</p>}
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
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
