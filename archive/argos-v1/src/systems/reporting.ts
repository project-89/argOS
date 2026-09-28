import { defineSystem, System, query, removeEntity, removeComponent } from 'bitecs';
import { World } from '../types';
import { Report } from '../components/Report';
import { reportRequests, sendDiscordMessage } from '../discord';
import { Agent } from '../components/Agent';

const reportQuery = query([Report]);
const agentQuery = query([Agent]);

export const createReportingSystem = (): System => {
  return defineSystem((world: World) => {
    const entities = reportQuery(world);
    for (const eid of entities) {
      const requestId = Report.requestId[eid];
      const channelId = reportRequests.get(requestId);

      if (channelId) {
        const agents = agentQuery(world);
        const reportMessage = `Report: There are currently ${agents.length} agents in the simulation.`;
        sendDiscordMessage(channelId, reportMessage);

        reportRequests.delete(requestId);
        removeComponent(world, Report, eid);
        removeEntity(world, eid);
      }
    }
    return world;
  });
}; 