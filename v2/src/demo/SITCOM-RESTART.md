# New episodes in the local sitcom demo

Launch `npm run demo:sitcom:ui -- --narrative-mind --reconsideration` and open the
full private `SITCOM_DEMO_READY` link. After **Stop & save** finishes, use
**New episode ↻** beside the playback controls. The new world is ready but idle;
choose **Simulation only** or **Go live** explicitly. Reset itself makes no model
or video requests. Contacts, messages, minds and world state start fresh.

The authenticated `/reset` endpoint refuses to reset a running episode, waits for
world persistence, and returns one successor per episode even across retries or
multiple tabs. The launcher starts a separate process on an automatically chosen
loopback port, inheriting the cognition flags and environment, with a fresh token
and recording directory. IPC reports readiness; a failed or timed-out child is
terminated and can be retried. Old requests cannot mutate the new ECS world.

The previous receiver and its recordings remain available at its original link.
This intentionally retains one idle replay process per previous episode; this is
a local demo launcher, not a bounded production session host. Save failures remain
visible, and the button cannot navigate away while browser recording uploads are
still finalizing. A world-journal failure blocks reset for operator recovery.

This change does not fix the separately identified renderer `source_ended` issue.
