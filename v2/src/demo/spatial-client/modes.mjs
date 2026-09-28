/** Experience modes: Watch (god's-eye diorama), Inhabit (be a body), Analysis
 * (frozen world, God console, interview chair). Pure transitions: the caller
 * performs the returned effects (network calls, pointer-lock release, dialogs).
 * No effect is assumed to have succeeded; the snapshot remains authoritative. */

export const MODES = Object.freeze(['watch', 'inhabit', 'analysis']);
export const MODE_LABELS = Object.freeze({ watch: 'Watch', inhabit: 'Inhabit', analysis: 'Analysis' });
const MODE_KEYS = Object.freeze({ Digit1: 'watch', Digit2: 'inhabit', Digit3: 'analysis',
  Numpad1: 'watch', Numpad2: 'inhabit', Numpad3: 'analysis' });

export function createModeState(initial = 'watch') {
  return { mode: MODES.includes(initial) ? initial : 'watch', returnMode: 'watch', pausedByAnalysis: false };
}

/** `ctx.controlled`: the snapshot reports a body under operator control.
 * `ctx.paused`: the snapshot reports the simulation frozen. */
export function transition(state, event, ctx = {}) {
  const controlled = !!ctx.controlled, paused = !!ctx.paused;
  const effects = [];
  const leaveAnalysis = next => {
    if (state.pausedByAnalysis && paused) effects.push('resume');
    return { ...state, mode: next, pausedByAnalysis: false };
  };
  switch (event?.type) {
    case 'select': {
      const target = event.mode;
      if (!MODES.includes(target) || target === state.mode) return { state, effects };
      if (target === 'analysis') {
        if (!paused) effects.push('pause');
        if (state.mode === 'inhabit') effects.push('release-pointer');
        return { state: { mode: 'analysis', returnMode: state.mode, pausedByAnalysis: !paused }, effects };
      }
      if (target === 'inhabit' && !controlled) {
        // No body yet: the caller offers a visitor or a resident. The mode only
        // changes once the snapshot confirms control (see `controlChanged`).
        effects.push('choose-body');
        return { state, effects };
      }
      if (state.mode === 'analysis') return { state: leaveAnalysis(target), effects };
      if (state.mode === 'inhabit') effects.push('release-pointer');
      return { state: { ...state, mode: target }, effects };
    }
    case 'escape': {
      if (state.mode === 'analysis') {
        const back = state.returnMode === 'inhabit' && !controlled ? 'watch' : state.returnMode;
        return { state: leaveAnalysis(back), effects };
      }
      if (state.mode === 'inhabit') { effects.push('release-pointer'); return { state: { ...state, mode: 'watch' }, effects }; }
      effects.push('dismiss');
      return { state, effects };
    }
    case 'controlChanged': {
      if (event.controlled && event.acquired && state.mode !== 'analysis') return { state: { ...state, mode: 'inhabit' }, effects };
      if (!event.controlled) {
        if (state.mode === 'inhabit') { effects.push('release-pointer'); return { state: { ...state, mode: 'watch' }, effects }; }
        if (state.mode === 'analysis' && state.returnMode === 'inhabit') return { state: { ...state, returnMode: 'watch' }, effects };
      }
      return { state, effects };
    }
    case 'externalResume': {
      // Someone resumed the world while we were analysing: stay in Analysis,
      // but do not resume again on exit.
      return { state: { ...state, pausedByAnalysis: false }, effects };
    }
    default: return { state, effects };
  }
}

/** Keyboard → mode event. Returns null when the key is not a mode shortcut or
 * the user is typing. `verbMenuOpen` claims 1-4 for the Inhabit verb chooser. */
export function modeKeyEvent(event, { typing = false, verbMenuOpen = false } = {}) {
  if (typing || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.code === 'Escape' || event.key === 'Escape') return { type: 'escape' };
  if (verbMenuOpen) return null;
  const mode = MODE_KEYS[event.code];
  return mode ? { type: 'select', mode } : null;
}

/** What the switcher shows for each mode. */
export function modeAvailability({ connected = true, controlled = false, controlSupported = true } = {}) {
  return {
    watch: { enabled: true, hint: 'The whole world' },
    inhabit: { enabled: connected && controlSupported, hint: controlled ? 'Return to your body' : 'Choose a body' },
    analysis: { enabled: connected, hint: 'Freeze, question, interview' },
  };
}
