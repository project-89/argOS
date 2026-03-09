import type { World } from "../ecs/world";
import type { SystemContext, SystemDefinition } from "../ecs/dynamic-systems";
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { Agent, Goal, KanbanBoard, KanbanCard, KanbanColumn, Name, OrgGovernance, OrgStaffingGovernor, Room } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getDirectContainer, listDirectContents, setLocatedIn } from "../ecs/location";
import { createAgentEntity } from "../ecs/prefabs";
import { setGoalContract } from "../cognition/goal-contract";

function normalize(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findEntityByName(world: World, name: string): number | undefined {
  const wanted = normalize(name);
  if (!wanted) return undefined;
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (normalize(Name.value[eid] || "") === wanted) return eid;
  }
  return undefined;
}

function findBoard(world: World, boardName?: string): number | undefined {
  const wanted = normalize(boardName || "");
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (!wanted) return eid;
    if (normalize(Name.value[eid] || "") === wanted) return eid;
  }
  // Allow selecting an uninitialized board device by name (Name only).
  if (wanted) return findEntityByName(world, boardName || "");
  return undefined;
}

function findColumn(world: World, boardEid: number, columnName: string): number | undefined {
  const wanted = normalize(columnName);
  if (!wanted) return undefined;
  for (const col of listDirectContents(world, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    const n = String(Name.value[col] || KanbanColumn.name[col] || "");
    if (normalize(n) === wanted) return col;
  }
  return undefined;
}

function findCardEid(world: World, boardEid: number, title: string): number | undefined {
  const wanted = String(title || "").trim();
  if (!wanted) return undefined;
  for (const col of listDirectContents(world, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    for (const child of listDirectContents(world, col)) {
      if (!entityExists(world as any, child)) continue;
      if (!hasComponent(world as any, child, KanbanCard as any)) continue;
      const t = String(Name.value[child] || KanbanCard.title[child] || "");
      if (t === wanted) return child;
    }
  }
  return undefined;
}

function listCardsInColumn(world: World, columnEid: number): number[] {
  const out: number[] = [];
  for (const eid of listDirectContents(world, columnEid)) {
    if (!entityExists(world as any, eid)) continue;
    if (!hasComponent(world as any, eid, KanbanCard as any)) continue;
    out.push(eid);
  }
  return out;
}

function isUnowned(world: World, cardEid: number): boolean {
  const owner = Number(KanbanCard.ownerEid[cardEid] ?? -1);
  if (owner < 0) return true;
  return !entityExists(world as any, owner);
}

function countOwnedWipCards(world: World, ownerEid: number, boardEid: number, wipColumns: string[]): number {
  let count = 0;
  for (const name of wipColumns) {
    const col = findColumn(world, boardEid, name);
    if (col === undefined) continue;
    for (const card of listCardsInColumn(world, col)) {
      if (Number(KanbanCard.ownerEid[card] ?? -1) !== Number(ownerEid)) continue;
      count++;
    }
  }
  return count;
}

function hasActiveTicketGoal(world: World, agentEid: number, cardTitle: string): boolean {
  const wanted = normalize(cardTitle);
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.status[gid] || "") !== "active") continue;
    const desc = normalize(Goal.description[gid] || "");
    if (desc.includes(wanted)) return true;
  }
  return false;
}

function hasCompletedTicketGoal(world: World, agentEid: number, cardTitle: string): boolean {
  const wanted = String(cardTitle || "").trim();
  if (!wanted) return false;
  const needle = `complete ticket: ${wanted}`.toLowerCase();
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (!entityExists(world as any, gid)) continue;
    if (!hasComponent(world as any, gid, Goal as any)) continue;
    if (String(Goal.status[gid] || "") !== "completed") continue;
    const desc = String(Goal.description[gid] || "").toLowerCase();
    if (desc.includes(needle)) return true;
  }
  return false;
}

function createTicketGoal(world: World, agentEid: number, boardEid: number, boardName: string, cardTitle: string): number {
  // Derive a ticket-specific contract from the card metadata when possible.
  const deriveContract = (title: string): { commandIncludes: string; requiredWritePaths: string[]; dependsOnTitles: string[]; rawDescription: string } => {
    const cardEid = boardEid >= 0 ? findCardEid(world, boardEid, title) : undefined;
    const desc = cardEid !== undefined ? String(KanbanCard.description[cardEid] || "") : "";
    // Command default:
    // - Prefer explicit mention in the ticket.
    // - Otherwise: only require CI for code/QA tickets (handled below).
    const lowerDesc = desc.toLowerCase();
    let commandIncludes = "";
    if (lowerDesc.includes("node test.cjs") || lowerDesc.includes("test.cjs")) commandIncludes = "node test.cjs";
    if (lowerDesc.includes("node ci.cjs") || lowerDesc.includes("ci.cjs")) commandIncludes = "node ci.cjs";

    const extractWritePaths = (value: string): string[] => {
      const raw = String(value || "").trim();
      if (!raw) return [];
      const matches = Array.from(raw.matchAll(/`?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.[A-Za-z0-9]+)`?/g)).map((x) => x[1]);
      if (matches.length) return matches;
      return raw
        .split(",")
        .map((s) => s.trim())
        .map((s) => s.replace(/^`/, "").replace(/`$/, ""))
        .map((s) => (s.includes(" ") ? s.slice(0, s.indexOf(" ")) : s))
        .map((s) => s.replace(/[.]+$/, ""))
        .filter(Boolean);
    };

    // Required writes: parse "Writes:" (preferred as a dedicated line, but accept inline fields too).
    // Example: "Writes: src/math.cjs, docs/incident.md"
    const requiredWritePaths: string[] = [];
    for (const line of desc.split(/\r?\n/)) {
      const m = line.match(/^\s*Writes\s*:\s*(.+)\s*$/i);
      if (!m || !m[1]) continue;
      extractWritePaths(m[1]).forEach((p) => requiredWritePaths.push(p));
    }
    if (requiredWritePaths.length === 0) {
      const inline = desc.match(/Writes\s*:\s*([^\n|]+)/i);
      if (inline && inline[1]) extractWritePaths(inline[1]).forEach((p) => requiredWritePaths.push(p));
    }

    // Dependencies: parse "DependsOn:" (preferred as a dedicated line, but accept inline fields too).
    // Example: "DependsOn: [ENG] Fix multiplication bug, [PM] Write incident report"
    const dependsOnTitles: string[] = [];
    const extractDependsOnTitles = (raw: string): string[] => {
      const out: string[] = [];
      for (const part of String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        let t = part.replace(/^`/, "").replace(/`$/, "").trim();
        // Common ticket prose appended after an inline DependsOn field.
        t = t.split(/\bMention\b/i)[0]!.trim();
        t = t.split(/\bWrites\b\s*:/i)[0]!.trim();
        t = t.split(/\bDo not\b/i)[0]!.trim();
        // If the title is followed by a sentence, keep only the title segment.
        if (t.startsWith("[") && t.includes(".")) t = t.split(".")[0]!.trim();
        t = t.replace(/[.]+$/, "").trim();
        if (t) out.push(t);
      }
      return out;
    };
    for (const line of desc.split(/\r?\n/)) {
      const dep = line.match(/^\s*DependsOn\s*:\s*(.+)\s*$/i);
      if (!dep || !dep[1]) continue;
      extractDependsOnTitles(dep[1]).forEach((t) => dependsOnTitles.push(t));
    }
    if (dependsOnTitles.length === 0) {
      const inline = desc.match(/DependsOn\s*:\s*([^\n|]+)/i);
      if (inline && inline[1]) {
        extractDependsOnTitles(inline[1]).forEach((t) => dependsOnTitles.push(t));
      }
    }

    return { commandIncludes, requiredWritePaths, dependsOnTitles, rawDescription: desc };
  };

  let { commandIncludes, requiredWritePaths: rawWritePaths, dependsOnTitles, rawDescription } = deriveContract(cardTitle);
  const requiredWritePaths = rawWritePaths
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    // Never require harness files or volatile runtime data to be patched as part of "work completion".
    .filter((p) => !["ci.cjs", "test.cjs"].includes(p));
  const isCodePath = (p: string): boolean => {
    const lower = String(p || "").toLowerCase();
    return lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".mjs");
  };
  const isCliTicket = (() => {
    const raw = `${cardTitle}\n${rawDescription}`;
    const beforeDeps = raw.split(/DependsOn\s*:/i)[0] || raw;
    return /usecli\s*:\s*true|cli_only|\(cli\)/i.test(beforeDeps);
  })();
  const roleWantsRun = /^\s*\[QA\]/i.test(String(cardTitle || ""));
  const requireRun = roleWantsRun || isCliTicket || requiredWritePaths.some(isCodePath);
  if (!requireRun) commandIncludes = "";
  if (requireRun && !String(commandIncludes || "").trim()) commandIncludes = "node ci.cjs";
  console.log(
    `[OrgStaffingGovernor] goal for "${cardTitle}": writes=[${requiredWritePaths.join(", ")}], deps=[${dependsOnTitles.join(", ")}], run="${commandIncludes}"`
  );

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agentEid, HasGoal(goalEid) as any);

  const clipped = rawDescription.trim().slice(0, 900);
  const descParts: string[] = [
    `Complete ticket: ${cardTitle}`,
    ...(clipped ? [`Ticket:\n${clipped}`] : []),
  ];
  if (requiredWritePaths.length) descParts.push(`Writes: ${requiredWritePaths.join(", ")}`);
  if (dependsOnTitles.length) descParts.push(`DependsOn: ${dependsOnTitles.join(", ")}`);
  if (commandIncludes) descParts.push(`Run: ${commandIncludes}`);
  Goal.description[goalEid] = descParts.join(" | ");
  if (process.env.DEBUG_ORG_STAFFING === "1") {
    console.log(`[OrgStaffingGovernor] goalDesc: ${String(Goal.description[goalEid] || "").slice(0, 260)}`);
  }
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  // Ticket contract:
  // - Perform required writes (if specified) so ownership actually implies work.
  // - Optionally require CI/test runs for code/QA tickets.
  // - Ticket board state (Review/Done) is a derived projection (handled by org systems).
  const isImagePath = (p: string): boolean => {
    const lower = String(p || "").toLowerCase();
    return (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif")
    );
  };
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_work" },
    success: {
      type: "all_of",
      conditions: [
        ...requiredWritePaths.map((p) =>
          isCliTicket || isCodePath(p)
            ? ({
                type: "any_of" as const,
                conditions: [
                  { type: "tool_exit_code_equals" as const, toolId: "workspace.replace_in_file", commandIncludes: p, equals: 0 },
                  { type: "tool_exit_code_equals" as const, toolId: "workspace.git_apply_from_last_gemini", commandIncludes: p, equals: 0 },
                ],
              })
            : (isImagePath(p)
                ? ({
                    type: "any_of" as const,
                    conditions: [
                      { type: "tool_exit_code_equals" as const, toolId: "workspace.write_file", commandIncludes: p, equals: 0 },
                      { type: "tool_exit_code_equals" as const, toolId: "nano_banana.generate_image", commandIncludes: p, equals: 0 },
                    ],
                  })
                : ({ type: "tool_exit_code_equals" as const, toolId: "workspace.write_file", commandIncludes: p, equals: 0 }))
        ),
        ...dependsOnTitles.map((t) => ({ type: "kanban_card_in_column" as const, boardName, cardTitle: t, columnName: "Done" })),
        ...(String(commandIncludes || "").trim() ? [{ type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes, equals: 0 }] : []),
      ] as any,
    },
  });

  return goalEid;
}

function parseDependsOnTitles(desc: string): string[] {
  const deps: string[] = [];
  const extractDependsOnTitles = (raw: string): string[] => {
    const out: string[] = [];
    for (const part of String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      let t = part.replace(/^`/, "").replace(/`$/, "").trim();
      t = t.split(/\bMention\b/i)[0]!.trim();
      t = t.split(/\bWrites\b\s*:/i)[0]!.trim();
      t = t.split(/\bDo not\b/i)[0]!.trim();
      if (t.startsWith("[") && t.includes(".")) t = t.split(".")[0]!.trim();
      t = t.replace(/[.]+$/, "").trim();
      if (t) out.push(t);
    }
    return out;
  };
  for (const line of String(desc || "").split(/\r?\n/)) {
    const m = line.match(/^\s*DependsOn\s*:\s*(.+)\s*$/i);
    if (!m || !m[1]) continue;
    extractDependsOnTitles(m[1]).forEach((t) => deps.push(t));
  }
  if (deps.length === 0) {
    const inline = String(desc || "").match(/DependsOn\s*:\s*([^\n|]+)/i);
    if (inline && inline[1]) {
      extractDependsOnTitles(inline[1]).forEach((t) => deps.push(t));
    }
  }
  return deps;
}

function areDependenciesDone(world: World, boardEid: number, deps: string[]): boolean {
  if (!deps.length) return true;
  const doneCol = findColumn(world, boardEid, "Done");
  if (doneCol === undefined) return false;
  for (const title of deps) {
    const card = findCardEid(world, boardEid, title);
    if (card === undefined) return false;
    if (getDirectContainer(world, card) !== doneCol) return false;
  }
  return true;
}

function getOrgGovernance(world: World): { enabled: boolean; doneRequiresReview: boolean; reviewColumnName: string } | null {
  for (let eid = 0; eid < (OrgGovernance.enabled as any).length; eid++) {
    if (!hasComponent(world as any, eid, OrgGovernance as any)) continue;
    if (OrgGovernance.enabled[eid] === false) continue;
    return {
      enabled: true,
      doneRequiresReview: OrgGovernance.doneRequiresReview?.[eid] === true,
      reviewColumnName: String(OrgGovernance.reviewColumnName?.[eid] || "Review") || "Review",
    };
  }
  return null;
}

export function createOrgStaffingGovernorSystem(): SystemDefinition {
  return {
    name: "OrgStaffingGovernor",
    description: "Deterministically spawns/assigns agents to kanban tickets (optional org simulation)",
    pseudocode: `
IF OrgStaffingGovernor.enabled:
  FIND kanban board
  FOR EACH unowned Backlog card:
    PICK available agent (or spawn if under maxAgents)
    MOVE card to In Progress
    SET ownerEid
    CREATE ticket goal/contract for agent
`,
    frequency: 250,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const governorEids = Array.from(query(world as any, [OrgStaffingGovernor] as any)).filter((eid) => entityExists(world as any, eid));
      if (governorEids.length === 0) return;

      for (const governorEid of governorEids) {
        if (!OrgStaffingGovernor.enabled[governorEid]) continue;

        const boardName = String(OrgStaffingGovernor.boardName[governorEid] || "");
        const boardEid = findBoard(world, boardName);
        if (boardEid === undefined || !entityExists(world as any, boardEid)) continue;
        if (!hasComponent(world as any, boardEid, KanbanBoard as any)) continue;

        const backlogCol = findColumn(world, boardEid, "Backlog");
        const inProgressCol = findColumn(world, boardEid, "In Progress");
        if (backlogCol === undefined || inProgressCol === undefined) continue;

        const maxAgents = Math.max(1, Number(OrgStaffingGovernor.maxAgents[governorEid] || 1));
        const wipPerAgent = Math.max(1, Number(OrgStaffingGovernor.wipPerAgent[governorEid] || 1));
        const defaultRole = String(OrgStaffingGovernor.defaultRole[governorEid] || "engineer") || "engineer";
        const claimPrefix = String(OrgStaffingGovernor.claimTitlePrefix[governorEid] || "").trim();

        const spawnRoomName = String(OrgStaffingGovernor.spawnRoomName[governorEid] || "");
        const spawnRoom =
          (spawnRoomName.trim() ? findEntityByName(world, spawnRoomName) : undefined) ??
          Array.from(query(world as any, [Room] as any)).find((eid) => entityExists(world as any, eid)) ??
          undefined;
        if (spawnRoom === undefined) continue;

        const agents = Array.from(query(world as any, [Agent] as any))
          .filter((eid) => entityExists(world as any, eid))
          .filter((eid) => Agent.active[eid] !== false);

        const wipColumns = ["In Progress", "Review"];
        const managedAgents = agents.filter((eid) => normalize(String(Agent.role[eid] || "")) === normalize(defaultRole));

        const backlogCards = listCardsInColumn(world, backlogCol)
          .filter((cardEid) => isUnowned(world, cardEid))
          .filter((cardEid) => {
            if (!claimPrefix) return true;
            const title = String(Name.value[cardEid] || KanbanCard.title[cardEid] || "");
            const t = title.toLowerCase();
            const p = claimPrefix.toLowerCase();
            if (t.startsWith(p)) return true;
            // Be tolerant of configs like "PM" when titles are "[PM] ...".
            if (!p.startsWith("[") && t.startsWith(`[${p}]`)) return true;
            return false;
          })
          // If a ticket declares DependsOn, don't even start it until deps are Done.
          // This reduces file-collision thrash and prevents agents from spamming CI while blocked.
          .filter((cardEid) => {
            const desc = String(KanbanCard.description[cardEid] || "");
            const deps = parseDependsOnTitles(desc);
            return areDependenciesDone(world, boardEid, deps);
          });

        for (const cardEid of backlogCards) {
          const title = String(Name.value[cardEid] || KanbanCard.title[cardEid] || "").trim();
          if (!title) continue;

          let assignee: number | undefined;
          for (const a of managedAgents) {
            if (countOwnedWipCards(world, a, boardEid, wipColumns) < wipPerAgent) {
              assignee = a;
              break;
            }
          }

          if (assignee === undefined) {
            if (managedAgents.length >= maxAgents) break;
            const agentName = `${defaultRole}_${managedAgents.length + 1}`;
            assignee = createAgentEntity(world as any, { name: agentName, role: defaultRole, systemPrompt: "x", roomId: spawnRoom });
            agents.push(assignee);
            managedAgents.push(assignee);
            ctx.log(`[OrgStaffingGovernor] spawned agent: ${agentName}`);
          }

          // Claim ticket.
          setLocatedIn(world, cardEid, inProgressCol);
          KanbanCard.ownerEid[cardEid] = assignee;
          KanbanCard.updatedAt[cardEid] = Date.now();

          // Ensure agent has a goal to complete the ticket.
          if (!hasActiveTicketGoal(world, assignee, title)) {
            const resolvedBoardName = String(Name.value[boardEid] || boardName || "Board");
            createTicketGoal(world, assignee, boardEid, resolvedBoardName, title);
          }
        }

        // Auto-close tickets: once an assignee's ticket goal is completed, move the owned card
        // through Review (if required) and into Done. This keeps kanban state as a projection
        // of grounded work completion, rather than a success precondition.
        const gov = getOrgGovernance(world);
        const reviewCol = gov?.doneRequiresReview ? findColumn(world, boardEid, gov.reviewColumnName || "Review") : undefined;
        const doneCol = findColumn(world, boardEid, "Done");
        if (doneCol !== undefined) {
          const columnsToScan = [
            findColumn(world, boardEid, "Backlog"),
            findColumn(world, boardEid, "In Progress"),
            findColumn(world, boardEid, "Review"),
          ].filter((x): x is number => typeof x === "number");

          for (const colEid of columnsToScan) {
            for (const cardEid of listCardsInColumn(world, colEid)) {
              const title = String(Name.value[cardEid] || KanbanCard.title[cardEid] || "").trim();
              if (!title) continue;
              const owner = Number(KanbanCard.ownerEid[cardEid] ?? -1);
              if (owner < 0 || !entityExists(world as any, owner)) continue;
              if (!hasCompletedTicketGoal(world, owner, title)) continue;

              const currentCol = getDirectContainer(world, cardEid);
              if (currentCol === doneCol) continue;

              if (gov?.doneRequiresReview && reviewCol !== undefined && currentCol !== reviewCol) {
                setLocatedIn(world, cardEid, reviewCol);
                KanbanCard.updatedAt[cardEid] = Date.now();
                continue;
              }

              setLocatedIn(world, cardEid, doneCol);
              KanbanCard.updatedAt[cardEid] = Date.now();
            }
          }
        }
      }
    },
  };
}
