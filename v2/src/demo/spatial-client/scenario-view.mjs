/** Only the public scenario flag changes the view. Text/action/goal content has
 * no say in whether the electricity has actually been repaired. */
import { worldTheme } from './theme-view.mjs';

export function scenarioLighting(scenario) {
  if (scenario?.id !== 'blackout') return { dim: false, lampOn: false };
  return { dim: scenario.power === 'off', lampOn: scenario.power === 'on' };
}

/** Authored café construction is the normal demo's operator tool, not a
 * substitute for Blackout's separately gated, need-driven world growth. */
export function allowsAuthoredCafe(scenario) {
  return !scenario;
}

/** Scenario copy reports the authored setup; it does not promise autonomous
 * construction, working phones, or successful future NPC behavior. */
export function worldPresentation(snapshot) {
  if (snapshot.scenario?.id === 'household') return {
    title: snapshot.scenario.title,
    description: `${snapshot.actors.length} people. A promise, a gathering, and choices of their own.\nChoose someone to see their thoughts and intentions.`,
    growth: snapshot.growth?.summary || 'One indoor chair site; proposals require evidence and approval.',
    rosterTitle: 'Meet the household.',
  };
  const town = snapshot.scenario?.id === 'town';
  return town ? { title: snapshot.scenario.title || 'A town of their own.',
    description: worldTheme(snapshot.scenario)
      ? `${snapshot.actors.length} residents. ${snapshot.rooms.length} places.\nA grounded coastal mystery. Choose a resident to follow their thoughts and intentions.`
      : `${snapshot.actors.length} residents. ${snapshot.rooms.length} places.\nChoose someone to see their thoughts and intentions.`,
    growth: snapshot.growth?.summary || 'Spatial construction is gated. This town is an authored testbed.',
    rosterTitle: 'Meet the residents.' }
    : { title: 'A life of their own.', description: `${snapshot.actors.length} people. A shared world.\nYou’re someone on the other side.`,
      growth: snapshot.growth?.summary || 'Growth is unavailable in this session.', rosterTitle: 'Meet the minds.' };
}

/** Decorative geometry around a permanent opening. No center slab or collision
 * shape is supplied, regardless of any object-state text on the passage. */
export function passageFrameParts(size) {
  const trim = Math.min(size.x * .08, size.y * .05, .10);
  const depth = Math.max(.09, size.z);
  return [
    { size: [trim, size.y, depth], position: [-(size.x - trim) / 2, size.y / 2, 0] },
    { size: [trim, size.y, depth], position: [(size.x - trim) / 2, size.y / 2, 0] },
    { size: [size.x, trim, depth], position: [0, size.y - trim / 2, 0] },
  ];
}
