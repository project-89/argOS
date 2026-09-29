/** Cross-session skill library: split learned skills from lived memories,
 * abstract them, select the ones that keep working, and seed new worlds. */
export * from "./library";
export { setSkillWorldAdapter, getSkillWorldAdapter, type SkillWorldAdapter } from "./world-adapter";
export { abstractProcedure, abstractBehaviorTree, abstractText, buildNameIndex, goalKeywords, goalPatternMatches } from "./abstraction";
export { bindPerson, bindPlaceQuery, bindTargetQuery, fillPlaceholders } from "./binding";
export { harvestWorldSkills, snapshotRegistryBaseline, type HarvestResult } from "./harvest";
export { attachSkillLibrary, seedWorldFromLibrary, countSeededSkills, type SkillLibraryConfig, type SkillLibrarySession,
  type SkillSeedReport, type SkillHarvestReport } from "./session";
