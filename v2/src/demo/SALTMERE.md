# Saltmere: "What the Sea Was Paid" — 2026-09-28

Design brief: [Alive World pass](../architecture/ALIVE-WORLD-2026-09-28.md).
For the development profile (God chat, generated mechanics) see
[World development](WORLD-DEVELOPMENT.md) and add `--develop`.

## Try it

```sh
ARGOS_SPATIAL_SECONDS=300 npm run demo:spatial -- --live --lovecraft
```

Open the private loopback URL the server prints, then press **Start world**.
The ready preview makes no model requests; Start enables paid NPC and spirit
cognition for at most the configured duration. Without `--live` this is a
manual physics fixture (operator actions only), useful for checking objects and
verbs offline.

## The story (public premise)

Thirty-one years ago the trawler *Marrow Star* went out on a storm night and
did not come back. Three men were lost. The town tells it as the Three Hooks:
when three hooked marks appear, the sea is counting what it is owed, and three
knocks come before it takes. Tonight, at 18:00, hooked marks are turning up
again — on the Net House supplies box, on a table in the failing Waking Gull
Cafe and on a pot in Widow's Garden — and some of the dead men's children and
grandchildren have come back for answers.

Ten residents share four cottages. Every one of them wants something tonight,
hides something, and is on a collision course with at least one neighbour.
Nobody's outcome is scripted.

## What residents can do

Walk, look closely, talk, eat, sit and use their phones as before, plus real,
timed object verbs with receipts (installed in the story profiles):

| Verb | How | Who learns what |
| --- | --- | --- |
| `read` | `interact target="<document>" content="read"` | Only the reader gets the text; onlookers see them reading. |
| `give` | `content="give <person>"` on a held object (or native `give`) | Possession moves; giver, recipient and onlookers perceive the hand-over. |
| `show` | `content="show <person>"` or `"show"` | Viewers see the object and, for documents, the open page only. |
| `put` | `content="put <box or table>"` | Placed in an open box or on a table, visibly. |
| `hide` | `content="hide <box>"` | Placed inside and the lid shut; invisible to everyone until opened. |
| `knock` | `interact target="<house or door knocker>" content="knock 3"` | People inside hear the knocks but not who; onlookers see the knocker. |
| `write_note` | `interact target="<table or seat>" content="write_note <words>"` | A new anonymous note in the writer's hand (≤280 characters, 12 per session). |

Each resident also has their own evening (Tess runs evening service at the
Gull, Bea walks the garden, Ada works the late bench, Leon calls on old friends,
Noor is off duty at the Gull...) instead of a shared "leisure → sit" block.

## Story objects

- *Marrow Star* logbook — shut in the Gull House sea chest.
- Mara's mother's letter — in Mara's pocket.
- Agnes Wick's diary — on the Tidemark House table.
- Otis's pocketknife, pale paint on the blade — on the Gull House table.
- Leon's heart pills — on the Rook House table.
- A door knocker on the front of each cottage, on the common.

## Author's sheet (spoilers — Narrator and daemons only)

The *Marrow Star* was a smuggling run. Leon's late brother Callum Brand paid
Tom Hale (Mara's father), Ruben Voss (Eli's grandfather) and skipper Jonah Wick
(Agnes's husband, Sera's grandfather) double shares to meet a Dutch boat despite
a gale warning. Young Leon kept the books, told the Three Hooks story at the
inquest so no one asked about cargo, and hid the log in the Net House box.
Callum paid the families "sea money" every year. Whether anything else is out
in the water is never settled.

| Resident | Secret and pressure | Opening move |
| --- | --- | --- |
| Mara | Mum's letter: "Ask Leon what the sea was paid." | Confront Leon at Rook House. |
| Ivo | Saw Otis force the box; owes Otis a card debt; in love with Mara and lying to her. | Shadow Mara away from the box; lean on Otis. |
| Tess | Scratched Cafe table 1 herself to sell a haunted cafe; texting collector Harlan Pryce. | Pull people into the Gull; keep Bea out of it. |
| Ada | Hears three knocks at night in Rook House and is terrified; suspects Eli. | Corner Eli about the knocks and the cut. |
| Leon | Knows and helped bury the truth; failing heart; dreads Mara, adores Eli. | Ask Noor what he said under sedation. |
| Eli | Really Eli Voss, Ruben's grandson; saw Otis carry something home. | Ask Ada about the cut; get near Otis. |
| Sera | Holds Agnes's diary: "L. knows. He tells the sea story so no one asks about the cargo." | Make Bea explain the painted pot; decide about Mara. |
| Noor | Heard Leon say "I let them go out" under sedation; bound by confidentiality. | Go to the Gull; shield Leon's heart from Mara. |
| Bea | Painted over Agnes's three hooks to "keep the sea from counting"; believes it. | Check the pot; have it out with Tess. |
| Otis | Forced the box; has the logbook in his sea chest; selling to Harlan Pryce; paint on his knife. | Move the logbook before Bea looks; silence Ivo. |

Cross-links worth playing: the pale paint in the box cut, on Otis's knife and on
Bea's pot is the same Gull House fence paint; Tess and Otis are both courted by
Pryce and don't know it; Mara and Eli lost family on the same boat and don't
know it; Ada's night knocks are unexplained.

`getSaltmereAuthorCast()` in `spatial-lovecraft-town.ts` returns this cast sheet
(want, secret, voice, pressure) for the Narrator and daemons. Residents receive
only their own secret and voice, appended to their private system prompt.

## Verification

Offline only; no provider calls. See the task report for exact suite counts.
