# Saltmere settlement: a town that has to keep itself alive

Ten Saltmere residents live headless in the real ECS on bare land with
natural resources:
- the Shingle (fish),
- Birch Wood (trees that grow back, brambles that fruit again),
- Well Spring,
- the Old Quarry,
- a flax field,
- the Common, with a market stall, a campfire, a chopping stump, spare
  tools, and staked-out bare plots.

Each has a trade:

| Resident | Trade |
|---|---|
| Otis, Leon | fishers |
| Tess | cook |
| Ada | net-mender |
| Eli, Sera | woodcutters |
| Bea | grows flax |
| Noor | forages |
| Ivo, Mara | builders |

Everything is data (`saltmere-land.ts`), so the Weaver can grow it.

## What makes it a living economy

- **Everything takes time.** `Settlement.perform` resolves when an act
  completes on the settlement's clock. Materials commit at the start and
  products appear at the end. The clock moves only when every living
  resident is busy or waiting, and stands still while anyone asks the model.
- **Needs.** Hunger and thirst rise. A resident who stays at the limit
  collapses.
- **Chains.** Nets catch fish and tear after 10 uses. Torn nets are mended
  at a net rack with twine, which is spun from flax at a workbench. Logs are
  split for firewood and sawn into planks. Cooking takes 3 raw fish and 1
  firewood to make 3 cooked fish.
- **The town builds itself.** The builders' plan: a workshop (the plot
  becomes a workbench), a net rack, then five houses. A builder claims a plot
  until it is finished.
- **The market.** Producers sell what their duty says the stall is short
  of. The stall buys at three quarters of its price. The treasury pays
  builders and a daily share that covers subsistence.

## How residents decide and learn

- **A small deterministic will decides what to do.** Thirst and hunger come
  first: eat what is in hand, else buy it, else forage or draw water. Then
  the trade's duties, then rest.
- **The trade's skill graph decides how** (`../skill-graph.ts`,
  `../skill-runtime.ts`). Each trade keeps its own graph across lives;
  memories are not kept.
- **The model is asked only for what the graph cannot yet make.**
  - A way that fails for want of goods (a spent source, an empty stall, no
    coin) is scarcity, not ignorance. The resident looks for one alternative
    per item, then waits.
  - Ways are ranked by reliability, then by measured time per item, so
    buying beats fishing when both work.

## Offline result (manual stand-in planner, 5 days × 3 lives)

| life | alive | model calls | notes |
|---|---|---|---|
| 1 | 10/10 | 53 | town built on day 1–2 (workshop, net rack, 5 houses) |
| 2 | 10/10 | 18 | almost all on day 1 |
| 3 | 10/10 | 17 | almost all on day 1 |

## Live result (Gemini 3.8 flash plans every trade, the Weaver grows the world; 3 days × 2 lives)

| life | alive | model calls | by day | built |
|---|---|---|---|---|
| 1 | 10/10 | 72 | 70 · 1 · 1 | workshop, net rack, 5 houses (day 1) |
| 2 | 10/10 | 31 | 28 · 1 · 2 | workshop, net rack, 5 houses (day 1) |

In total: 103 planner calls and about 168k tokens, with 1 malformed reply.

- **The Weaver invented an axe.** Axes ran short (four in the whole town), so
  it designed a hafted stone axe: knapped from quarry stone and bound to a
  firewood handle with spun twine at the workbench. The design validated and
  residents used it.
- **An earlier live run found a real bug.** A builder died of thirst ten
  hours into one building job, with coin in hand and water on the stall.
  Urgent needs now break off work.

Earlier versions died instructively:
- **Wood ran out on day 1.** Trees now grow back.
- **Everyone went broke.** Workers whose goods were fully stocked could not
  sell, and the cook could not buy fish. This led to the daily share, the
  stall's margin, and producers keeping a little of their own food.
- **A cook taught herself to fish** because the stall was empty the first
  time she looked. Measured time per item now ranks buying first.

## Run

```
npm run settlement -- --days 5 --lives 3              # offline
npm run settlement -- --live --days 3 --lives 2       # Gemini plans (≤120 calls per life), the Weaver grows what nothing gives
```

## Limits

- **Headless only.** This is not yet mounted in the 3D spatial Saltmere
  (props, positions, voices).
- **A fixed will.** The needs/trade priorities are fixed code, not the
  residents' own minds. Personas and drama do not yet steer work.
- **Tuned by hand.** The economy is hand-tuned (prices, share, regrowth).
