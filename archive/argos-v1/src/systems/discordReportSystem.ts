import { defineSystem, System, query, removeEntity } from 'bitecs';
import { World } from '../types';
import { StimulusComponent } from '../components/Stimulus';
import { StimulusSource } from '../types/stimulus';
import { sendDiscordMessage } from '../discord';

const stimulusQuery = query([StimulusComponent.component]);

const announcementChannelId = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;

export const createDiscordReportSystem = (): System => {
  return defineSystem((world: World) => {
    if (!announcementChannelId) {
      return world;
    }

    const entities = stimulusQuery(world);
    for (const eid of entities) {
      if (StimulusComponent.component.source[eid] === StimulusSource.SYSTEM) {
        try {
          const content = JSON.parse(StimulusComponent.component.content[eid]);
          const summary = `Summary of activity: ${content.data}`;
          sendDiscordMessage(announcementChannelId, summary);
        } catch (e) {
          console.error('Failed to parse stimulus content', e);
        } finally {
          removeEntity(world, eid);
        }
      }
    }

    return world;
  });
}; 