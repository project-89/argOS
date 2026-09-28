import { Script, createContext } from "node:vm";
import { renderSitcomReplay, type SitcomFrame } from "../sitcom-report";

test("standalone saved replay retains per-message identities and loads legacy messages without inventing a sender", () => {
  const message = (id: number, direction: string, contact?: { name: string; relationship: string; context: string }) => ({ id, direction, contact, text: "Is this your number?", status: "delivered", createdMs: 0, deliveredMs: 0, readMs: -1, replyTo: -1 });
  const alex = { name: "Alex", relationship: "friend", context: "" };
  const suspicious = { name: "</script><script>throw Error('injected')</script>", relationship: "police", context: "" };
  const frame: SitcomFrame = { sourceId: "fixture", atSimMs: 0, tick: 0, running: false,
    provenance: { cognition: "fixture", h3: false, evolution: false, outsideText: "operator" }, actors: [],
    facts: { cookieContainer: "Tin", cookieConsumed: false, cookieConsumedBy: null, tin: "closed", phoneContainer: "Counter", unread: 0, buzzes: 0 },
    phone: [message(1, "in", alex), message(2, "out", alex), message(3, "in", suspicious), message(4, "in")], droppedEvents: 0 };
  const html = renderSitcomReplay([frame], [], []);
  class Element {
    value = "0"; max = "0"; textContent = ""; className = ""; children: Element[] = [];
    append(...children: Element[]) { this.children.push(...children); } replaceChildren() { this.children = []; }
  }
  const elements = new Map<string, Element>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  get("data").textContent = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1];
  const code = html.match(/<script>([\s\S]*)<\/script>/)![1];
  new Script(code).runInContext(createContext({ document: { getElementById: get, createElement: () => new Element() } }));
  const labels = get("phone").children.map(bubble => bubble.children[0]);
  expect(labels.map(label => label.textContent)).toEqual(["Alex · friend → Elaine", "Elaine → Alex · friend", `${suspicious.name} · police → Elaine`, "Unknown sender → Elaine"]);
  expect(labels.every(label => label.children.length === 0)).toBe(true);
  expect(html).not.toContain(suspicious.name);
});
