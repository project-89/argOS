# Repository checkpoint — 2026-09-27–28 Pacific

This records repository hygiene and validation, not a new simulation-quality
milestone. The engine's behavioral next steps and open gates remain in the
[tick/Narrator checkpoint](../v2/src/demo/TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md).

## Commits and active entrypoint

- `a9c5c2d` — coherent engine checkpoint: the accumulated ECS, cognition,
  runtime, world-building, persistence, demo, rendering and test work. These
  modules import one another, including public demo/rendering exports from the
  library; splitting them arbitrarily by folder would produce broken snapshots.
- `817fa11` — historical runtime/document archival, current agent guidance,
  scripts-only root dispatcher, documentation links and generated-output policy.
- This document records the validation and local cleanup evidence for those
  checkpoints. No commit was pushed and no user server was restarted.

Start at [AGENTS.md](../AGENTS.md), then [v2/README.md](../v2/README.md).
The library entry remains `v2/src/index.ts::createSimulation`. Root commands
delegate to `v2`; engine dependencies stay there. Old runtimes are explicitly
under [archive/](../archive/README.md), while Psyche-BT remains an independent
[research project](../research/README.md).

CANON now distinguishes intended architecture from current implementation
records. Old agent entry documents are preserved with hashes in
[docs/archive/entrypoints/](archive/entrypoints/README.md). Older v2 specs,
plans and proposals are indexed in [v2/docs/](../v2/docs/README.md).

## Validation

- **Staged-tree typecheck passed**, using an isolated checkout of the index
  with dependencies linked in. This was not merely a check of unstaged files.
- Root-dispatched typecheck passed after the move.
- Spatial viewer's Node tests: **110 passed** (including asset hashes/licenses).
- Root test-command forwarding: **21 passed in two offline suites**.
- Previous focused engine/advice check: **496 passed in 23 suites**. It remains
  a targeted selection, not full repository coverage.
- Thirteen active entry/checkpoint documents: **96 local links checked, zero
  missing targets**. Historical archived copies intentionally preserve old paths.
- Staged whitespace checks passed. The two original CC0 license files retain
  their exact upstream bytes; their CRLF/spacing is exempted narrowly, not by
  disabling source-code checks.

### Broader suite: known failures, not a green certification

A separate full-suite attempt uses an isolated source copy, a ten-minute wall
ceiling, disabled live-test opt-in, disabled dotenv credential loading, fixture
provider credentials and a deny-external-network guard for parent/child
processes. This is an offline test-run budget, **not** the ten-minute live-world
endurance gate. Test discovery found **491 Jest files**; behavior scripts and
browser `.mjs` tests are separate.

Known failing suites discovered in that audit:

1. `v2/src/spirits/__tests__/architect-admission.test.ts`: rejected-mechanic
   redesign fixture expects the successful close operation to change the
   description from "Running valve" to "stopped". The water-state assertion
   passes; the description assertion fails.
2. `v2/src/demo/__tests__/sitcom-client.test.ts`: 42 reported failing test titles
   involving playback/polling fixture
   expectations fail (missing polling timer, prompt-log count, unexpected stop).

These failures were preserved rather than fixed or weakened during cleanup.
The ten-minute wall ceiling stopped the audit: **188 of 491 suite files reported
results — 186 passed, two failed, 303 unreported**. The final Jest JSON was not
produced at that cutoff, so individual-test pass/skip totals are unavailable.
No outbound attempts were logged; the test process group and its workers were
stopped. No automatic retry or extension followed. Exact partial coverage is in
`argos-checkpoint-partial-results.json` in the private validation bundle. Do not
treat unexecuted tests or a passing typecheck as a full-suite pass.
Some older `src/tests` scripts are excluded from both TypeScript and Jest and
still contain stale imports; they are not supported current entrypoints.

## Artifact cleanup and recovery

Exact-file cleanup removed **261 files / 728,315,296 logical bytes**:
duplicate downloaded ripgrep binaries/archives in old office sandboxes,
duplicate generated validation bundles, one decoded analysis WAV and one
low-frame-rate review proxy. No directories were recursively deleted.

Each target was checked against exact path, size, modification time, inode and
SHA-256, with open-file checks before deletion. Retained originals were verified.
The historical validator was compressed and round-trip hash-verified before
duplicates were removed (1,648,957 compressed bytes). Those bundles are generated
candidate test tooling, not accepted release sources or reload artifacts.

Private restoration evidence:

- `v2/recordings/cleanup-repository-20260927/manifest.json`
- `v2/recordings/cleanup-repository-20260927/actions.jsonl`
- `v2/recordings/cleanup-repository-20260927/RESTORE.md`

Tool copies can be restored byte-for-byte from retained references; validators
from the verified gzip. Analysis audio/proxy can be regenerated from the original
video. Original recordings, curated demos, failed-run traces, prior cleanup
archives, snapshots, builder sources and all licenses remain. The older cleanup
archives contain unique failure evidence and were deliberately **not** removed.

Loose old logs/scratch/image-generation artifacts moved into ignored
`v2/recordings/repository-scratch-20260927/`; this is archival, not a claim of disk
space reclaimed. Three formerly tracked analysis outputs are also recoverable
from Git history. New generated eval/chronicle output is ignored; existing
versioned baseline evidence was not silently untracked.

All figures are logical file bytes, not a measured filesystem free-space delta.
Raw paths, prompts and recordings stay local; the cleanup manifest is not a
public media release.

## Evidence, limitations and follow-up

Private validation bundle: `v2/recordings/repository-checkpoint-vexqJD/`.
It retains the pre-cleanup working-tree patch, untracked-file backup, relocation
map, checks, audit notes and failure evidence. It is intentionally not committed.
Initial working evidence was in `/tmp/argos-repo-checkpoint-rQrNbe`.

A historical private log matched a configured credential. It remains ignored
and outside the commit; no credential value was printed. Review it separately
before any log publication. Source/asset checks found no configured credential
to add to the checkpoint. Historical license metadata also disagrees (old README
MIT versus old package ISC); archival did not choose or change the project license.

Next repository work: diagnose the recorded failing tests, keep this status
indexed, and run an appropriately bounded broader regression selection after
repairs. Next engine work remains repeated perception/action projection and
reasoning-demand measurement. Do not change models or expand world-generation
authority merely to improve a cleanup checkpoint.

The user town on port 51090 was left running at its original version. Restarting
it, spending provider credits, publishing artifacts or pushing commits requires
a separately scoped action. The ten-trial baseline and ten-minute simulation
endurance requirements remain open and unchanged.
