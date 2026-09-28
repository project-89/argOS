import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { SimulationRuntime } from '../runtime/SimulationRuntime';
import { addEntity, addComponent, set } from 'bitecs';
import { Report } from '../components/Report';
import { StimulusComponent as Stimulus } from '../components/Stimulus';
import { StimulusSource, StimulusType } from '../types/stimulus';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const monitorChannelId = process.env.DISCORD_MONITOR_CHANNEL_ID;

if (!token) {
  throw new Error('DISCORD_BOT_TOKEN is not defined in the .env file');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

export const reportRequests = new Map<number, string>();
let reportRequestId = 0;

client.once('ready', () => {
  console.log('Discord client is ready!');
});

export const sendDiscordMessage = (channelId: string, message: string) => {
  const channel = client.channels.cache.get(channelId);
  if (channel && channel.isTextBased()) {
    (channel as TextChannel).send(message);
  }
};

export const initializeDiscord = (runtime: SimulationRuntime) => {
  client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    if (message.content === '!report') {
      const eid = addEntity(runtime.world);
      addComponent(runtime.world, Report, eid);
      const requestId = reportRequestId++;
      reportRequests.set(requestId, message.channel.id);
      Report.requestId[eid] = requestId;
    } else if (message.channel.id === monitorChannelId) {
      const eid = addEntity(runtime.world);
      const componentData = {
        source: StimulusSource.SYSTEM,
        type: StimulusType.AUDITORY,
        content: JSON.stringify({
          data: `A message was posted in the monitored channel: "${message.content}" by ${message.author.tag}`,
        }),
        timestamp: Date.now(),
      };
      addComponent(runtime.world, eid, set(Stimulus, componentData));
    }
  });

  client.login(token);
}; 