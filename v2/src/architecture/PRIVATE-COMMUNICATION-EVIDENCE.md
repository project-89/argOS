# Private communication evidence

`CommunicationMemory` is an actor-owned ECS component containing bounded JSON
receipts. It is separate from `SocialMemory`: recording a text does not create
speech, audible listeners, a public event, a goal or a commitment.

`recordPrivateCommunication` is a trusted transport adapter API, not a model tool
or independent proof that a send occurred. The producer must finish its actual
send/read action first. The adapter checks live actor/source, bounded fields,
timestamp ordering and replay identity. The apartment phone invokes it only in
its already-fenced successful action completion path. Failed/canceled typing
does not produce a sent receipt. Reading is a separate personally observed fact.

Receipts retain exact content, channel, sender/recipient labels, durable message
identity, sent time and observation time; reads additionally require delivery
time. A sender receipt does not prove delivery or recipient reading. No sender
profile, raw message body or source ID is interpreted as an instruction.

Semantic coordination reviews may cite personally sent receipts using the
existing `speechId` field (a compatibility name for a communication source ID).
They still require explicit actor review. Incoming messages cannot be undertaken
as the actor's own promises. Review admission is fenced against source changes;
reviewed work starts unverified and needs normal attributed execution/evidence.
Foreground source filtering includes own private receipts, not just spoken turns.

Private source reviews do not use the audible-listener publication path. This
implementation does not automatically synchronize the sender's private progress
with a recipient, even one who read a message. Future recipient accounts must
derive from that recipient's actual read/disclosure, not access the sender ledger.

Ownership and receipts serialize through the normal built-in component schema.
Restored historical receipts are memories, not replayable transport operations.
Malformed stores and mismatched actor ownership are not exposed. Retention is
64 receipts per actor; this is bounded working correspondence, not an unlimited
mail archive. No behavioral improvement is established by these data tests alone.
