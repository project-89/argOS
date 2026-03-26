/**
 * Entities Panel - View non-agent dynamic entities in the world
 */

import { Box, MapPin, Activity, Hash } from "lucide-react";
import { useSimulationStore, type EntitySummary } from "../../store/simulation";

type GenericEvent = {
  type: string;
  timestamp: number;
  entityId?: number;
  name?: string;
  message?: string;
  content?: string;
};

export function EntitiesPanel() {
  const { entities, selectedEntity, setSelectedEntity, events, status } = useSimulationStore();

  if (entities.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Box className="w-12 h-12 text-argos-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-argos-text-primary mb-2">No Dynamic Entities</h2>
          <p className="text-argos-text-muted">
            {status !== "connected"
              ? "Connect to the simulation bus to see entities."
              : "Non-agent entities created by systems or spirits will appear here."}
          </p>
          {status !== "connected" && (
            <p className="text-xs text-argos-status-error mt-2">
              WebSocket status: {status}
            </p>
          )}
        </div>
      </div>
    );
  }

  const selected = entities.find((e) => e.name === selectedEntity);

  return (
    <div className="h-full flex">
      <div className="w-80 border-r border-argos-border overflow-auto">
        <div className="p-4 border-b border-argos-border bg-argos-bg-tertiary">
          <h2 className="font-semibold text-argos-text-primary flex items-center gap-2">
            <Box className="w-5 h-5 text-argos-system" />
            Entities ({entities.length})
          </h2>
        </div>
        <div className="p-2 space-y-1">
          {entities.map((entity) => (
            <EntityListItem
              key={entity.id}
              entity={entity}
              isSelected={entity.name === selectedEntity}
              onClick={() => setSelectedEntity(entity.name)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {selected ? (
          <EntityDetail entity={selected} events={events as GenericEvent[]} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-argos-text-muted">Select an entity to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EntityListItem({
  entity,
  isSelected,
  onClick,
}: {
  entity: EntitySummary;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-all ${
        isSelected
          ? "bg-argos-system/20 border border-argos-system/40"
          : "bg-argos-bg-tertiary hover:bg-argos-bg-elevated border border-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-argos-text-primary truncate block">{entity.name}</span>
          <p className="text-xs text-argos-text-muted capitalize truncate">{entity.type}</p>
        </div>
        {entity.room && (
          <span className="text-xs text-argos-text-muted flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {entity.room}
          </span>
        )}
      </div>
    </button>
  );
}

function EntityDetail({ entity, events }: { entity: EntitySummary; events: GenericEvent[] }) {
  const entityEvents = events
    .filter((event) => {
      if (event.entityId === entity.id) return true;
      if (event.name && event.name === entity.name) return true;
      const text = `${event.message || ""} ${event.content || ""}`;
      return text.includes(entity.name);
    })
    .slice(0, 40);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-argos-system/20 flex items-center justify-center">
          <Box className="w-8 h-8 text-argos-system" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-semibold text-argos-text-primary">{entity.name}</h2>
          <p className="text-argos-text-secondary mt-1 capitalize">{entity.type}</p>
          {entity.description && (
            <p className="text-sm text-argos-text-muted mt-2">{entity.description}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-system/10 text-argos-system flex items-center justify-center mb-3">
              <MapPin className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Room</p>
            <p className="text-lg font-semibold text-argos-text-primary">
              {entity.room || "Unassigned"}
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="p-4">
            <div className="w-10 h-10 rounded-lg bg-argos-bg-tertiary text-argos-text-secondary flex items-center justify-center mb-3">
              <Hash className="w-5 h-5" />
            </div>
            <p className="text-xs text-argos-text-muted">Entity ID</p>
            <p className="text-lg font-semibold text-argos-text-primary">{entity.id}</p>
          </div>
        </div>
      </div>

      {entity.gridPosition && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Grid Position</span>
          </div>
          <div className="panel-content text-sm text-argos-text-secondary">
            x={entity.gridPosition.x}, y={entity.gridPosition.y}
            {entity.gridPosition.facing ? `, facing=${entity.gridPosition.facing}` : ""}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title flex items-center gap-2">
            <Activity className="w-4 h-4 text-argos-system" />
            Related Events
          </span>
        </div>
        <div className="panel-content">
          {entityEvents.length === 0 ? (
            <p className="text-sm text-argos-text-muted italic">No related events captured yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {entityEvents.map((event, idx) => (
                <div key={`${event.type}-${event.timestamp}-${idx}`} className="p-2 bg-argos-bg-tertiary rounded text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-argos-system">{event.type}</span>
                    <span className="text-argos-text-muted">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-argos-text-secondary">
                    {event.content || event.message || "(no details)"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
