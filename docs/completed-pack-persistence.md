# Completed-pack persistence contract

Normal authenticated desktop and mobile pack openings share one boundary:

1. `ensurePackOpenClientEventId` creates a stable event ID when the logical pack is generated.
2. The reveal surface uses a synchronous completion claim so only the completed reveal enqueues.
3. One version-3 queue entry represents one completed pack: `id`, `userId`, `setId`, `cards`, `createdAt`, `attempts`, `nextRetryAt`, and `submissionVersion` (plus the existing optional pack-count hint).
4. `completedPackQueue.js` sanitizes and deduplicates the queue before every read, obtains a per-user browser lock, and submits entries serially.
5. Every request is exactly `{ batches: [{ client_event_id, cards }] }`. The shared builder rejects zero or multiple batches before Supabase is called.
6. `increment_collection_cards(jsonb)` atomically owns the collection receipt, collection increment, pack event, profile statistics, idempotency, and rate limits.

Malformed, cross-set, unsupported-version, explicit event-only, and ambiguous multi-pack queue entries are discarded once with payload-free diagnostics. Valid versionless single-pack entries are upgraded. Duplicate `(userId, client event ID)` entries retain the most complete representation.

Transient errors retain the pack with capped exponential backoff and jitter. Rate-limited packs remain queued with a controlled delay. Authentication/account-switch failures stop the drain and preserve the original owner's entry. Permanent validation failures are removed after one diagnostic. Logout and account switching cancel scheduled drains.

Welcome rewards and onboarding use their separate server-owned transactions. Guest packs remain local until the existing guest/account flow handles them. Scanner actions use the scanner RPC and never enter this queue.
