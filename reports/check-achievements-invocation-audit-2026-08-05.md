# `check-achievements` production invocation audit

Date: 2026-08-05
Production baseline audited: `c9ee76ee7636b505dd214df762c5e54c9cbda01b`

## Root cause

The production client had two direct transports in `src/lib/userAchievements.js` and several mobile wrappers around them. The principal duplicate path was not a per-card loop: `syncPendingCloudPulls` already single-flighted the queue drain, but every caller awaiting that shared drain independently processed the same aggregate `saved > 0` result and then invoked `check-achievements`. Startup/account loading, normal pack persistence, and focus/online/app-resume recovery could therefore share one durable pack save and each issue a POST, including duplicate POSTs only milliseconds apart.

The old 30-second reconciliation cache applied only to the profile reconciliation transport. Pack checks explicitly invalidated it and had no shared in-flight promise, no progression fingerprint cache, and no cross-window/server deduplication. React StrictMode could expose the non-idempotent async completion because an old mount's account-loading work could finish alongside the remounted caller even though event-listener cleanup itself was present.

## Before-fix call graph

Line numbers below refer to the production baseline commit above.

| Source | Trigger and cadence | Same-action companion | Could overlap? |
|---|---|---|---|
| `src/lib/userAchievements.js:125` | Direct `check-achievements` transport for `profile_reconcile`; once per explicit achievement-progress load, subject only to the profile-only 30-second cache. | Pack transport and any queue-recovery caller. | Yes; its cache/single-flight did not cover pack checks or other browser contexts. |
| `src/lib/userAchievements.js:190` | Direct `check-achievements` transport for `pack_and_collection`; once per wrapper call. | Every mobile wrapper below. | Yes; no module-wide single-flight or pack-state cache. |
| `mobile-app/src/App.jsx:3280` | Mobile onboarding completion callback; once per completed onboarding finalization. | Account load immediately before it could flush pending packs and check at line 3854. | Yes. |
| `mobile-app/src/App.jsx:3676` | Achievement progress reconciliation; called by the Achievements button (`openAchievements`), not by Profile mount. | Any durable pack/recovery check. | Yes. |
| `mobile-app/src/App.jsx:3730-3737` | `runPostPackAchievementFlow` wrapper; one POST each time the wrapper ran. | Called by normal durable pack success and welcome-reward completion. | Yes. |
| `mobile-app/src/App.jsx:3769` then `3852-3861` | Startup/account-scoped state load drains the pending queue and checks once if the aggregate drain saved one or more packs. | Normal save or focus/resume caller could await the same drain and also check. | Yes; this was a primary duplicate path. |
| `mobile-app/src/App.jsx:4453` then `4471-4481` | Online, focus, visibility, or native app-resume recovery; one check per listener caller whose shared drain result reported saved packs. | Other listener events, account load, and normal save. | Yes; multiple callers could consume the same single-flight drain result. |
| `mobile-app/src/App.jsx:4807` then `4861-4873` | Normal completed-pack persistence; optimistic local collection/stats update first, then one check after successful atomic cloud confirmation. | Startup/recovery callers could share the same queue result and issue additional checks. | Yes. |
| `mobile-app/src/App.jsx:5114-5127` | Welcome-reward durable claim completion; one post-pack check per claim. | Account/onboarding recovery work. | Yes. |

No direct `/functions/v1/check-achievements` fetch existed. No dynamic function-name wrapper targeted this function. Desktop source had no call site. The committed mobile bundle contained the same old client transport, but the desktop and mobile React roots were not both mounted on one page.

## Findings for the requested risk list

1. Normal pack completion had one explicit post-save wrapper, not two independent pack callbacks. The duplicates came from that callback overlapping the account/recovery consumers of the same queue-drain result.
2. Normal packs updated local state optimistically but invoked only after cloud confirmation. There was no separate optimistic POST; duplicate cloud consumers created the double calls.
3. Normal packs were checked once per completed pack call, not per card. Scanner additions only invalidated the old reconciliation cache and did not POST.
4. Queue replay checked once per aggregate drain caller, not once per queued item. Ten queued packs were saved sequentially, then one caller checked; concurrent callers could each repeat that aggregate check.
5. No achievement-calling effect depended on collection/stats objects, arrays, or render-recreated callbacks.
6. `INITIAL_SESSION` was explicitly ignored by the auth listener, but session initialization/account loading could flush the queue; concurrent initialization/remount work could repeat the post-drain call.
7. Profile and Collection did not check on mount. Achievement progress checked only when the Achievements control was explicitly opened.
8. Listener cleanup and Supabase subscription cleanup were present. The defect was duplicated async completion, not leaked registered listeners.
9. React StrictMode could expose the non-idempotent async account-load completion and shared-drain consumer behavior.
10. Desktop source did not invoke the function. A stale service-worker/mobile bundle could temporarily coexist across clients during deployment, but there was no second legacy desktop runtime call site.
11. Multiple tabs/PWA windows had independent module caches and could check the same account. The queue had a cross-context lease, but the subsequent achievement POST did not.
12. No retry loop treated a successful empty result as retryable. The old transport had no bounded transient retry policy.
13. Pack/unique/total categories were evaluated in one `pack_and_collection` request; profile reconciliation additionally evaluated value and set mastery in one request. There was no category-per-request loop.
14. Award/result state updates did not feed an effect that scheduled another check.

## After-fix call graph

| Source | Trigger and cadence | Deduplication behavior |
|---|---|---|
| `src/lib/achievementCheckScheduler.js:204-211` | The only client transport permitted to invoke `check-achievements`. | Per-user module single-flight; four-second coalescing; persisted user/scope/progression fingerprint; cross-window `navigator.locks` where supported; three-attempt maximum only for network, 429, or 5xx failures; one request ID across retries. |
| `mobile-app/src/lib/cloudCollection.js:337-377` | The authoritative pack path. Schedules only when the complete aggregate queue drain reports `saved > 0` and returns durable stats. | One scheduled check after the whole batch. All startup, normal-save, focus, online, visibility, native-resume, and timer-driven queue flushes converge here. |
| `mobile-app/src/App.jsx:3274-3288` | Successful durable onboarding completion. | Coalesced/fingerprinted with other calls for the user. |
| `mobile-app/src/App.jsx:3384-3425` | Successful durable scanner collection addition. | Schedules after the RPC succeeds; invalidates richer profile-reconciliation cache for collection-only changes. |
| `mobile-app/src/App.jsx:3682-3703` | Explicit Achievements control only. | Uses the same scheduler with `profile_reconcile`; no Profile/Collection mount call. |
| `mobile-app/src/App.jsx:4349-4354` | Subscription to fresh scheduler results. | Displays/merges awards without making a request; cleanup is returned by the effect. |
| `mobile-app/src/App.jsx:5053-5099` | Successful durable welcome-reward claim. | Coalesced/fingerprinted with other user progression work. |

Logout/account changes clear only the departing user's module state and persisted fingerprints. A durable mutation that arrives during an older profile reconciliation remains queued so pre-mutation profile data cannot suppress a later valid check.

## Server defense in depth

`check-achievements` now computes its fingerprint from authoritative persisted values: authenticated user ID, scope, packs opened, total cards pulled, unique cards, and (for profile reconciliation) collection value in cents and completed sets. It claims a service-role-only row keyed by user, scope, and fingerprint before evaluating or inserting achievements. A repeated completed check returns a harmless response with no replayed awards; an active duplicate returns a harmless pending/deduplicated response. Claims have a 30-second lease, failed owned claims are released for a bounded client retry, and older completed fingerprints are pruned so storage remains bounded.

The client-provided fingerprint is diagnostic only and is not trusted for server deduplication or awards. RLS is enabled on the dedup table, all `anon`/`authenticated` grants are revoked, and only `service_role` can access it.

## Atomic pack-save RPC assessment

Achievement evaluation was not moved into `increment_collection_cards`. That RPC intentionally owns one narrow transaction for the idempotent pack receipt, collection quantities, pack event, and compact stats. Current achievement reconciliation also requires catalog/value/set-completion reads and service-role award writes. Folding those operations into the pack transaction would expand its locks, latency, privileges, and failure boundary, so an achievement-side failure could threaten pack-save durability. The production-safe design keeps the existing atomic RPC unchanged and schedules one deduplicated post-commit evaluation. A future database-only design would need a separately proven transactional/outbox contract before replacing this path.

## Expected request volume

Before: one normal durable pack intended one POST, but overlapping consumers could produce two or more for the same saved pack; an aggregate queue drain could similarly be checked once per caller. This explains clustered duplicates within milliseconds even though the hour-wide average (623 POSTs for about 612 achievement-relevant pack actions) was only slightly above one.

After: zero POSTs for render, mount, tab navigation, profile refresh, auth refresh, or a queue drain that saves nothing; at most one client POST per new durable progression fingerprint within a browser context; one POST after an entire offline batch; and a harmless server-deduplicated response for unavoidable cross-context duplicates. Rapid genuine pack progress may coalesce below one POST per pack, while still evaluating the latest authoritative counters.

## Verification status

- Focused achievement/request tests: 29 passed, 0 failed.
- Pack durability, queue, auth, pagination, and write-boundary regression tests: 101 passed, 0 failed.
- Production build and 12 generated-route verification: passed.
- Complete repository baseline comparison: fix branch 638 passed / 9 failed; exact production baseline has the same 9 unrelated failures (missing/generated scanner/iOS artifacts and existing presentation expectations).
- Supabase migration dry run: only `20260805143000_achievement_check_dedup.sql` would be applied.

Deployment and live pack-opening verification are recorded in the final incident report after rollout.
