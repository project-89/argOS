import * as THREE from 'three';
import { walkIntent, walkVector, createWalkSender, interactOptions, verbFromKey, talkTarget, MOVEMENT_CODES } from './inhabit-controls.mjs';
import { createLookState, applyLook, toggleView, cameraPose, yawBehind, smoothing, pullIn } from './inhabit-camera.mjs';
import { createSubtitleQueue } from './subtitles.mjs';
import { speakableText } from './voice-client.mjs';
import { actorAccent } from './framing-view.mjs';

/** Inhabit mode: a perspective camera behind (or inside) the controlled body,
 * keyboard/mouse input routed through the device-independent `controls`
 * facade, the contextual E prompt, the talk box, subtitles of heard speech and
 * the operator-only "nearby minds" panel. The body only ever acts through
 * /api/control/*; the view never moves it locally. */
export function createInhabitView({ el, controls, notify, getNode, voice, reducedMotion = false, onPauseToggle, onRelease, obstruction }) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 1200);
  let look = createLookState(), active = false, state = null, control = null, bodyKey = null, snapped = false, aimed = false;
  let options = null, optionsSignature = '', verbMenuOpen = false, talking = false, talkRow = null, minds = false;
  let subtitleSignature = '', identitySignature = '', mindsSignature = '', hiddenBody = null, walkError = 0, dragging = false;
  let lastPointerLockExit = 0;
  const held = new Set(), subtitles = createSubtitleQueue();
  const desiredPosition = new THREE.Vector3(), desiredTarget = new THREE.Vector3(), currentTarget = new THREE.Vector3();
  const sender = createWalkSender({ hz: 6, send: vector => controls.walk(vector.dx, vector.dy).catch(error => {
    if (performance.now() - walkError > 4000) { walkError = performance.now(); notify(error.status === 404 ? 'Walking isn’t available on this server yet.' : error.message, true); }
  }) });

  const safe = (parent, tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; parent.append(node); return node; };
  const bodyNode = () => bodyKey ? getNode(bodyKey) : null;
  const paused = () => state?.paused === true;

  function showBody(visible) {
    const node = bodyNode();
    if (hiddenBody && hiddenBody !== node) { hiddenBody.root.visible = true; hiddenBody = null; }
    if (!node) return;
    node.root.visible = visible;
    hiddenBody = visible ? null : node;
  }
  function releasePointer() { if (document.pointerLockElement) document.exitPointerLock?.(); }

  function renderIdentity() {
    const actor = state?.actors?.find(a => a.key === bodyKey), entity = state?.entities?.find(e => e.key === bodyKey);
    const room = actor?.room ?? state?.rooms?.find(r => r.id === entity?.roomId)?.name ?? '—';
    const signature = JSON.stringify([control?.name, control?.visitor, room, entity?.color]);
    if (signature === identitySignature) return;
    identitySignature = signature;
    el('hud-name').textContent = control?.name ?? '—';
    el('hud-kind').textContent = control?.visitor ? 'VISITOR' : 'YOU ARE';
    el('hud-place').textContent = room;
    el('hud-avatar').textContent = (control?.name ?? '·').slice(0, 1).toUpperCase();
    el('hud-avatar').style.background = actorAccent(entity ?? { key: bodyKey });
  }

  function renderPrompt() {
    const signature = JSON.stringify([options?.target?.key, options?.verbs?.map(v => v.verb), verbMenuOpen, talking]);
    if (signature === optionsSignature) return;
    optionsSignature = signature;
    const prompt = el('interact-prompt');
    prompt.hidden = !options || talking;
    if (!options) { verbMenuOpen = false; el('verb-menu').hidden = true; return; }
    el('prompt-label').textContent = options.primary.label;
    const more = options.verbs.length - 1;
    el('prompt-more').textContent = verbMenuOpen ? '1–4 · Esc' : more > 0 ? `+${more} more` : '';
    el('prompt-more').hidden = !el('prompt-more').textContent;
    const menu = el('verb-menu'); menu.replaceChildren(); menu.hidden = !verbMenuOpen;
    if (verbMenuOpen) for (const verb of options.verbs) {
      const item = safe(menu, 'li', ''), button = safe(item, 'button', '', verb.index === 1 ? 'primary-verb' : '');
      button.type = 'button'; safe(button, 'kbd', String(verb.index)); safe(button, 'span', verb.label);
      button.addEventListener('click', () => perform(verb.verb));
    }
  }

  function renderSubtitles(now) {
    const lines = subtitles.visible(now);
    const signature = JSON.stringify(lines.map(line => [line.id, line.text, !!line.speaking, !!line.partial]));
    if (signature === subtitleSignature) return;
    subtitleSignature = signature;
    const box = el('subtitles'); box.replaceChildren();
    for (const line of lines) {
      const row = safe(box, 'div', '', `subtitle${line.self ? ' self' : ''}${line.speaking ? ' speaking' : ''}${line.partial ? ' partial' : ''}`);
      safe(row, 'span', line.self ? 'You' : line.speaker, 'speaker');
      safe(row, 'span', line.text);
    }
  }

  function renderMinds() {
    const panel = el('inhabit-mind');
    panel.hidden = !minds;
    document.getElementById('app')?.classList.toggle('minds-visible', minds);
    el('hud-minds').setAttribute('aria-pressed', String(minds));
    if (!minds || !state) return;
    const body = state.actors?.find(a => a.key === bodyKey);
    const at = key => state.entities?.find(e => e.key === key)?.position;
    const here = at(bodyKey), distance = key => { const p = at(key); return here && p ? Math.hypot(p.x - here.x, p.z - here.z) : Infinity; };
    // Everyone sharing the room or within sight distance; nearest first.
    const nearby = (state.actors ?? []).filter(a => a.key !== bodyKey && (a.room === body?.room || distance(a.key) <= 14))
      .sort((a, b) => distance(a.key) - distance(b.key)).slice(0, 6);
    const own = body && !control?.visitor && (body.thought?.text || body.focus?.description) ? body : null;
    const signature = JSON.stringify([own?.thought?.text, own?.focus?.description, nearby.map(a => [a.key, a.thought?.text, a.focus?.description, a.action])]);
    if (signature === mindsSignature) return;
    mindsSignature = signature;
    const list = el('inhabit-mind-list'); list.replaceChildren();
    if (own) {
      const row = safe(list, 'li', '', 'own-mind');
      safe(row, 'strong', `${own.name} · resting while you drive`);
      if (own.thought?.text) safe(row, 'p', `“${own.thought.text}”`);
      if (own.focus?.description) safe(row, 'small', `${own.focus.kind === 'activity' ? 'Was doing' : 'Wants'} · ${own.focus.description}`);
    }
    if (!nearby.length) { safe(list, 'li', 'No one else is near.'); return; }
    for (const actor of nearby) {
      const row = safe(list, 'li', '');
      safe(row, 'strong', `${actor.name}${Number.isFinite(distance(actor.key)) ? ` · ${Math.round(distance(actor.key))} m` : ''}`);
      safe(row, 'p', actor.thought?.text ? `“${actor.thought.text}”` : 'No articulated thought.');
      if (actor.focus?.description) safe(row, 'small', `${actor.focus.kind === 'activity' ? 'Doing' : 'Wants'} · ${actor.focus.description}`);
    }
  }

  function openTalk(row = talkTarget(control?.nearby)) {
    if (!control) return;
    talking = true; talkRow = row ?? null; held.clear(); sender.update(null, performance.now());
    el('talk-to').textContent = talkRow ? `To ${talkRow.name}` : 'Speaking aloud';
    el('talk-box').hidden = false; document.getElementById('app')?.classList.add('talking');
    releasePointer();
    el('talk-input').focus();
    optionsSignature = ''; renderPrompt();
  }
  function closeTalk() {
    talking = false; el('talk-box').hidden = true; el('talk-input').value = '';
    document.getElementById('app')?.classList.remove('talking');
    if (document.activeElement === el('talk-input')) el('talk-input').blur();
    optionsSignature = ''; renderPrompt();
  }
  async function say(text, row = talkRow ?? talkTarget(control?.nearby)) {
    const trimmed = String(text ?? '').trim(); if (!trimmed || !control) return;
    subtitles.echo(trimmed, control.name, performance.now());
    try {
      const result = await controls.say(trimmed, row?.key);
      // Someone else has the floor: the line waits for a gap (or cuts in shortly).
      if (result?.queued) notify('Waiting for a pause in the conversation…');
    }
    catch (error) { notify(error.status === 404 ? 'Speaking isn’t available on this server yet.' : error.message, true); }
  }
  async function perform(verb) {
    if (!options) return;
    const target = options.target, label = options.verbs.find(row => row.verb === verb)?.label ?? verb;
    verbMenuOpen = false; optionsSignature = ''; renderPrompt();
    if (verb === 'talk') { openTalk({ key: target.key, name: target.name }); return; }
    try {
      const result = await controls.interact(verb, target.key);
      if (result && result.ok === false) notify(result.reason || 'That didn’t work.', true);
      else notify(`${label}…`);
    } catch (error) { notify(error.status === 404 ? 'Acting isn’t available on this server yet.' : error.message, true); }
  }

  el('talk-box').addEventListener('submit', event => { event.preventDefault(); const text = el('talk-input').value; closeTalk(); void say(text); });
  el('talk-input').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTalk(); } });
  el('hud-view').addEventListener('click', () => toggleCameraView());
  el('hud-minds').addEventListener('click', () => { minds = !minds; mindsSignature = ''; renderMinds(); });
  el('hud-pause').addEventListener('click', () => onPauseToggle?.());
  el('hud-release').addEventListener('click', () => onRelease?.());

  function toggleCameraView() {
    look = toggleView(look); snapped = false;
    el('hud-view-label').textContent = look.view === 'first' ? 'First person' : 'Third person';
    document.getElementById('app')?.classList.toggle('first-person', look.view === 'first' && active);
    showBody(look.view !== 'first' || !active);
  }

  /** Attach look input to the WebGL canvas (drag, or pointer lock on click). */
  function attach(canvas) {
    canvas.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0) return;
      dragging = true;
      if (!document.pointerLockElement && performance.now() - lastPointerLockExit > 400) {
        try { const request = canvas.requestPointerLock?.(); request?.catch?.(() => {}); } catch {}
      }
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) lastPointerLockExit = performance.now(); });
    document.addEventListener('mousemove', event => {
      if (!active) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !(dragging && event.buttons & 1)) return;
      look = applyLook(look, event.movementX, event.movementY, locked ? 0.0024 : 0.0045);
    });
  }

  return {
    camera,
    attach,
    get active() { return active; },
    get verbMenuOpen() { return verbMenuOpen; },
    get talking() { return talking; },
    get minds() { return minds; },
    get bodyKey() { return bodyKey; },
    /** Esc inside Inhabit: close the innermost thing first. Returns true if consumed. */
    escape() {
      if (performance.now() - lastPointerLockExit < 250) return true;
      if (talking) { closeTalk(); return true; }
      if (verbMenuOpen) { verbMenuOpen = false; optionsSignature = ''; renderPrompt(); return true; }
      return false;
    },
    resize(width, height) { camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); },
    enter() {
      active = true; snapped = false; aimed = false;
      document.getElementById('app')?.classList.toggle('first-person', look.view === 'first');
      showBody(look.view !== 'first');
      optionsSignature = ''; identitySignature = ''; renderIdentity(); renderPrompt(); renderMinds();
    },
    exit() {
      active = false; held.clear(); sender.reset(); verbMenuOpen = false;
      if (talking) closeTalk();
      releasePointer(); showBody(true);
      document.getElementById('app')?.classList.remove('first-person', 'minds-visible');
      el('interact-prompt').hidden = true;
    },
    sync(next, now) {
      state = next; const nextControl = next?.control ?? null;
      if (nextControl?.actorKey !== bodyKey) { showBody(true); snapped = false; aimed = false; }
      control = nextControl; bodyKey = control?.actorKey ?? null;
      const fresh = subtitles.ingest(control, now);
      if (active) {
        for (const line of fresh) {
          if (line.self) continue;
          const speaker = next.actors?.find(a => a.name === line.speaker) ?? next.entities?.find(e => e.kind === 'actor' && e.name === line.speaker);
          // Voices are cast per resident key; an unknown speaker stays a subtitle.
          if (speaker) voice?.enqueue({ id: line.id, text: speakableText(line.text, 420), speakerKey: speaker.key });
        }
      }
      options = interactOptions(control?.nearby);
      if (!options) verbMenuOpen = false;
      el('hud-frozen').hidden = !paused();
      el('hud-pause-label').textContent = paused() ? 'Resume' : 'Pause';
      if (active) { renderIdentity(); renderPrompt(); renderMinds(); }
    },
    /** Voice queue status → which subtitle is being spoken. */
    voiceStatus(status, now) {
      const id = status?.playing?.phase === 'playing' ? status.playing.id : null;
      for (const line of subtitles.visible(now)) if (line.speaking && line.id !== id) subtitles.speaking(line.id, false, now);
      if (id) subtitles.speaking(id, true, now);
    },
    frame(now, delta) {
      if (!active) return null;
      const node = bodyNode();
      // Start behind the body, looking where it faces.
      if (node && !aimed) { look = { ...look, yaw: yawBehind(node.root.rotation.y) }; aimed = true; }
      if (node) {
        const height = node.entity?.size?.y ?? 1.65;
        const room = state?.rooms?.find(r => r.id === node.entity?.roomId);
        const pose = cameraPose(node.root.position, height, look, { indoor: room ? room.environment !== 'outdoor' : false });
        // Never look at the body through a wall: pull in in front of the first obstruction.
        const hit = pose.pivot && obstruction ? obstruction(pose.pivot, pose.position) : null;
        const position = hit === null || hit === undefined ? pose.position : pullIn(pose.pivot, pose.position, hit);
        desiredPosition.set(position.x, position.y, position.z);
        desiredTarget.set(pose.target.x, pose.target.y, pose.target.z);
        const k = !snapped || reducedMotion ? 1 : smoothing(delta, look.view === 'first' ? 0.05 : 0.14);
        camera.position.lerp(desiredPosition, k); currentTarget.lerp(desiredTarget, k);
        if (!snapped) { camera.position.copy(desiredPosition); currentTarget.copy(desiredTarget); snapped = true; }
        camera.lookAt(currentTarget);
        if (look.view === 'first' && node.root.visible) showBody(false);
      }
      if (!talking && !paused()) sender.update(walkVector(walkIntent(held), look.yaw), now);
      else sender.update(null, now);
      renderSubtitles(now);
      return camera;
    },
    /** Returns true when the key was consumed. `typing` = focus in a text field. */
    keydown(event, { typing = false } = {}) {
      if (!active || typing) return false;
      if (MOVEMENT_CODES.includes(event.code)) { held.add(event.code); event.preventDefault(); return true; }
      if (verbMenuOpen) {
        const verb = verbFromKey(options, event.code);
        if (verb) { event.preventDefault(); void perform(verb.verb); return true; }
      }
      switch (event.code) {
        case 'KeyE':
          if (event.repeat || !options) return !!options;
          if (verbMenuOpen || options.verbs.length === 1) void perform(options.primary.verb);
          else { verbMenuOpen = true; optionsSignature = ''; renderPrompt(); }
          return true;
        case 'Enter': case 'NumpadEnter': event.preventDefault(); openTalk(); return true;
        case 'KeyC': if (!event.repeat) toggleCameraView(); return true;
        case 'KeyO': if (!event.repeat) { minds = !minds; mindsSignature = ''; renderMinds(); } return true;
        default: return false;
      }
    },
    keyup(event) { if (held.delete(event.code)) return true; return false; },
    blur() { held.clear(); },
    say,
    openTalk,
    talkTarget: () => talkRow ?? talkTarget(control?.nearby),
  };
}
