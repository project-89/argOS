/** Offstage life: traditional-AI bodies and summarized scenes for residents the
 * observer cannot perceive. See offstage-life.ts for the design stance. */
export { DEFAULT_OFFSTAGE_CONFIG, installOffstageLife, getOffstageLife, setOffstageHost, getOffstageStats,
  offstageForegroundReady, noteForegroundDecisionStarted, reflectionFor, type OffstageConfig, type OffstageHost, type OffstageStats } from "./offstage-life";
export { runOffstageDriver, isBodyFree } from "./offstage-driver";
export { hasDueOffstageScene, runOffstageScene, parseOffstageScene, isProgressibleGoal, trackOffstagePlaces, OFFSTAGE_SCENE_SYSTEM } from "./scene-resolver";
