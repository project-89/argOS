import type { SceneActor } from "../rendering/scene-director";
import type { ScreenBeat } from "./sitcom-screenplay";

type Member = Pick<SceneActor, "id" | "identityKey">;
/** Editorial memory only. Clone for a candidate and commit with its screenplay.
 * Never selects behavior or reads private conversation/attention state. */
export class ConversationFraming {
  private scope?: string;
  private end = 0;
  private turns: Member[] = [];
  private pair?: readonly Member[];
  private until = 0;
  private eligibleAt = 17000;
  clone() {
    const copy = new ConversationFraming();
    Object.assign(copy, this); copy.turns = [...this.turns];
    return copy;
  }
  select(source: string, room: number, start: number, end: number,
    beats: readonly ScreenBeat[], actors: readonly SceneActor[]): readonly Member[] | undefined {
    const scope = JSON.stringify([source, room]);
    if (this.scope !== scope || this.end !== start) {
      this.scope = scope; this.turns = []; this.pair = undefined;
      this.eligibleAt = start + 17000;
    }
    this.end = end;
    const local = actors.filter(a => a.roomId === room);
    const same = (a: Member, b: Member) => a.id === b.id && a.identityKey === b.identityKey;
    const present = (a: Member) => local.some(b => same(a, b));
    const speech = beats.filter(b => b.roomId === room && b.kind === "speech");
    const moving = beats.some(b => b.roomId === room && b.kind === "action" && b.operation === "move");
    for (const b of speech) {
      if (b.speechSlice?.starts === "resumes_utterance") continue;
      const actor = local.find(a => a.id === b.actorId && (!b.actorKey || a.identityKey === b.actorKey));
      if (!actor) continue;
      const member = { id: actor.id, identityKey: actor.identityKey };
      if (!this.turns.length || !same(this.turns.at(-1)!, member)) this.turns.push(member);
      this.turns = this.turns.slice(-3);
    }
    if (this.pair && (start >= this.until || moving || !this.pair.every(present)
      || speech.some(b => !this.pair!.some(a => a.id === b.actorId && (!b.actorKey || a.identityKey === b.actorKey))))) {
      this.pair = undefined; this.eligibleAt = end + 17000; this.turns = [];
    }
    // An observed alternating exchange earns one held setup, not one cut per
    // reply. Movement/third-party dialogue returns to the established ensemble.
    if (!this.pair && !moving && start >= this.eligibleAt && this.turns.length === 3
      && same(this.turns[0], this.turns[2]) && this.turns.every(present)) {
      const pair = this.turns.slice(0, 2).sort((a, b) => a.id - b.id);
      if (speech.length && speech.every(b => pair.some(a => a.id === b.actorId))) {
        this.pair = Object.freeze(pair.map(a => Object.freeze(a))); this.until = start + 17000;
      }
    }
    return moving ? undefined : this.pair;
  }
}
