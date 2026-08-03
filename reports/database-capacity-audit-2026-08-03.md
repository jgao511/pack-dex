# PackDex Database Capacity Audit

**Audit date:** 2026-08-03

**Mode:** production read-only

**Protected production baseline:** `a423856c81d33530d6e961c4e790e0e1bf568089`

**Database changes implemented:** none

## Decision summary

The database measured **243,182,739 B (231.92 MiB)** at 2026-08-03 14:45:56Z. The project is provisioned with a **2 GB gp3 disk**. At 14:49:40Z the database filesystem reported **552,992,768 B used**, **1,524,080,640 B available**, and **26.62% utilization**. The Management API returned null disk-autoscale limits; that exact response is recorded, but it is not treated as proof that the platform can or cannot autoscale without provider confirmation.

The three protected persistence relations now allocate **200.66 MiB**, or **86.52%** of `pg_database_size`:

- `user_collection`: 98.30 MiB
- `user_pack_open_events`: 63.99 MiB
- `user_collection_increment_events`: 38.38 MiB

The new **65–70 MiB/day** estimate remains a credible short-term surge warning. A longer 14.79-hour observation, excluding the audit's original dedicated 100-pack test, measured **39.48 MiB/day**. The current trailing-24-hour pack mix models **61.95 MiB/day**; the trailing-seven-day mix models **24.82 MiB/day**; and the full 23.26-day receipt-coverage mix models **8.19 MiB/day**. These are separate evidence windows, not interchangeable forecasts.

No receipt, event, collection, idempotency, authentication, achievement, reward, recovery, or real-user row was changed. No retention policy, archive, partition, table rewrite, blocking maintenance, index change, or persistence redesign was implemented.

## Measurement boundaries

PostgreSQL exposes exact row-datum sizes and exact current relation allocation. It does not retrospectively attribute individual 8 KiB heap/index pages, WAL, free-space-map allocation, or concurrent writes to one accepted pack. This report therefore distinguishes:

- **Exact logical sample bytes:** `pg_column_size` measurements from the controlled 100-pack sample.
- **Exact current allocations:** `pg_database_size`, `pg_table_size`, `pg_indexes_size`, relation sizes, row counts, and filesystem metrics.
- **Modeled marginal allocation:** current allocated bytes per row multiplied by the observed new-row mix.
- **Observed whole-database deltas:** exact size snapshots over bounded production intervals, including concurrent activity.
- **WAL:** transient/recycled write volume, not permanent relation size and not added to `pg_database_size`.

## Bytes added per accepted normal pack

### Exact logical 100-pack sample

The preserved controlled sample excludes one welcome-reward transaction and its nine extra collection rows. The remaining 100 accepted normal packs created:

| Component | Rows | Exact logical bytes | Exact logical B/pack |
|---|---:|---:|---:|
| Collection increment receipt | 100 | 11,597 | **115.97** |
| Pack-open event | 100 | 15,808 | **158.08** |
| New collection rows | 722 | 91,389 | **913.89** |
| **Total** | **922** | **118,794** | **1,187.94** |

The sample's **7.22 new collection rows/pack** represents a nearly empty test account. These are exact row-datum bytes, excluding indexes, WAL, page allocation, and concurrent activity.

### Current amortized allocation coefficients

| Relation | Heap B/row | Index B/row | Total B/row |
|---|---:|---:|---:|
| Receipt | 125.40 | 142.53 | **267.93** |
| Pack event | 163.91 | 252.13 | **416.04** |
| Collection identity | 145.54 | 257.70 | **403.24** |

For an observed novelty rate `n` new collection identities per accepted normal pack:

`modeled B/pack = 416.04 + 267.93 + (n × 403.24)`

At the trailing-24-hour novelty of **2.0752 rows/pack**, the model is approximately:

| Component | Heap B/pack | Index B/pack | Total B/pack |
|---|---:|---:|---:|
| Receipt | 125.40 | 142.53 | **267.93** |
| Pack event | 163.91 | 252.13 | **416.04** |
| Collection growth | 302.04 | 534.81 | **836.85** |
| **Total** | **591.35** | **929.47** | **1,520.82** |

Indexes account for approximately **61.1%** of modeled permanent growth at that mix. The major indexes enforce exact-once behavior, atomic upserts, event uniqueness, recent-event lookup, and complete collection loading; their bytes are not presumed redundant.

At the controlled fresh-account mix of 7.22 new rows/pack, the allocation model is about **3,595 B/pack**. It is an onboarding upper scenario, not the current mature-account average.

## Observed growth excluding the dedicated 100-pack test

From 2026-08-02 23:53:42.801Z through 2026-08-03 14:41:03.504Z:

- database size: 217,459,859 B → 242,969,747 B
- exact delta: **25,509,888 B** over 53,240.703 seconds
- accepted normal packs: **17,861**
- special receipts: **54**
- new normal-pack collection rows: **33,270**
- normal-pack novelty: **1.862718 rows/pack**
- whole-database slope: **39.480 MiB/day**
- whole-database quotient: **1,428.25 B/normal pack**

The original 100-pack audit test is outside this interval. Later pagination-verification packs are included because physical page allocation cannot be separated retrospectively. The quotient also includes special and unrelated concurrent writes, so it is not an exact causal per-pack value. The allocation model for the same mix is **1,435.10 B/pack** and **39.67 MiB/day**, within about 0.5% of the observed slope.

The earlier independent 14.23-minute interval measured **62.456 MiB/day** and remains valid short-horizon surge evidence, but is too short to use as a long-term slope by itself.

## Repeated JSON and card metadata

Historical `user_collection` metadata remains present in **26,580 rows**:

| Field | Exact logical bytes |
|---|---:|
| Name | 286,764 |
| Card number | 87,871 |
| Rarity | 256,256 |
| Image | 2,135,580 |
| `card_data` JSON | 0 |
| **Total** | **2,766,471 B (2.64 MiB)** |

Current atomic collection writes add none of this repeated metadata. It is therefore not causing current growth. Rewriting old rows would save at most 2.64 MiB logically, create WAL and dead tuples, risk compatibility evidence, and would not automatically shrink database files. Historical cleanup is not justified.

## Current largest objects

Exact allocations were queried read-only at 2026-08-03 14:49:25Z.

| Relation | Heap/TOAST | Indexes | Total |
|---|---:|---:|---:|
| `public.user_collection` | 37,208,064 B | 65,863,680 B | **103,071,744 B** |
| `public.user_pack_open_events` | 26,435,584 B | 40,665,088 B | **67,100,672 B** |
| `public.user_collection_increment_events` | 18,833,408 B | 21,405,696 B | **40,239,104 B** |
| `public.card_prices` | 3,899,392 B | 2,523,136 B | **6,422,528 B** |
| `public.user_achievements` | 1,990,656 B | 1,843,200 B | **3,833,856 B** |
| `public.user_collection_backup_pre_reset` | 3,366,912 B | 0 B | **3,366,912 B** |
| `public.user_binders` | 1,269,760 B | 237,568 B | **1,507,328 B** |
| `auth.refresh_tokens` | 425,984 B | 671,744 B | **1,097,728 B** |
| `public.public_pull_shares` | 688,128 B | 147,456 B | **835,584 B** |
| `auth.users` | 368,640 B | 434,176 B | **802,816 B** |

Estimated bloat is approximately **11.05 MiB**. Normal vacuum can make dead space reusable internally but does not normally shrink provisioned files. Blocking `VACUUM FULL` or broad reindexing is not justified.

### Largest indexes

| Index purpose | Size | Cumulative scans | Decision |
|---|---:|---:|---|
| Collection `(user_id,set_id,card_id)` unique | 27.30 MiB | 3,066,853 | Keep: atomic upsert and uniqueness |
| Collection `(user_id,card_id)` unique | 22.66 MiB | 1,193,849 | Keep: live legacy/scanner contract |
| Pack event `(user_id,client_event_id)` unique | 21.95 MiB | 206,869 | Keep: event idempotency |
| Receipt `(user_id,client_event_id)` primary key | 20.39 MiB | 232,637 | Keep permanently: replay protection |
| Pack event `(user_id,created_at DESC)` | 10.45 MiB | 201,898 | Keep: rate-limit/recent-event lookup |
| Collection primary key | 9.85 MiB | 217,376 | Keep: constraint |
| Pack event primary key | 6.33 MiB | 17 | Keep: correctness is not scan-count dependent |
| Collection `(user_id)` | 2.91 MiB | 106,896 | Keep: collection loading |

No core index is proven safe to drop. The low-scan market-price index is only 0.82 MiB and cannot address a tens-of-MiB/day slope without a separate caller and query-plan review.

## Normalized growth projections

| Evidence window | Packs/day | New rows/pack | Modeled/observed B/pack | MiB/day | 7 days | 30 days |
|---|---:|---:|---:|---:|---:|---:|
| Direct 14.79-hour observation | 28,985 | 1.8627 | 1,428.25 observed quotient | **39.48** | **276.36 MiB** | **1,184.40 MiB** |
| Trailing 24-hour pack model | 42,714 | 2.0752 | 1,520.78 modeled | **61.95** | **433.65 MiB** | **1,858.49 MiB** |
| Trailing 7-day pack model | 18,910.6 | 1.7167 | 1,376.24 modeled | **24.82** | **173.74 MiB** | **744.59 MiB** |
| Full 23.26-day receipt coverage | 6,429.8 | 1.6139 | 1,334.77 modeled | **8.185** | **57.29 MiB** | **245.54 MiB** |

### Logical-size thresholds

Starting from 231.92 MiB and treating the targets as GiB-scale logical database sizes:

| Scenario | 1 GiB | 4 GiB | 8 GiB |
|---|---:|---:|---:|
| Trailing 24-hour | 12.8 days | 62.4 days | 128.5 days |
| Direct 14.79-hour observation | 20.1 days | 97.9 days | 201.6 days |
| Trailing 7-day | 31.9 days | 155.7 days | 320.7 days |
| Full coverage average | 96.8 days | 472.1 days | 972.5 days |

The 4 GiB and 8 GiB rows assume a disk expansion; the current 2 GB disk cannot hold those logical sizes.

At current filesystem usage, modeled time to 70% utilization / full disk is approximately:

- trailing-24-hour surge: **13.9 / 23.5 days**
- direct observation: **21.8 / 36.8 days**
- trailing-seven-day model: **34.6 / 58.6 days**
- full-coverage model: **105 / 178 days**

## Collection pagination read impact

The pagination hotfix reads 500 rows/page and stops using confirmed total/range completion. The exact population snapshot at 2026-08-03 14:37Z contained 620 accounts, 462 with collection rows, 78 above 1,000 rows, and a maximum of 5,060 rows.

| Collection rows | Accounts | Requests/account | Aggregate requests |
|---|---:|---:|---:|
| 0 | 158 | 1 | 158 |
| 1–500 | 308 | 1 | 308 |
| 501–1,000 | 76 | 2 | 152 |
| 1,001–1,500 | 39 | 3 | 117 |
| 1,501–2,000 | 22 | 4 | 88 |
| 2,001–2,500 | 9 | 5 | 45 |
| 2,501–3,000 | 4 | 6 | 24 |
| 3,501–4,000 | 1 | 8 | 8 |
| 4,001–4,500 | 1 | 9 | 9 |
| 4,501–5,000 | 1 | 10 | 10 |
| 5,001+ | 1 | 11 | 11 |

Formula: `requests = max(1, ceil(rows / 500))`.

One full load by every account now requires **930 reads**, versus 620 previously: **+310 requests (+50%)**. Among accounts with collection rows, it is 772 versus 462: **+67.1%**. Complete loading returns **254,893 rows**, versus 197,973 under the old 1,000-row cap: **+56,920 row records (+28.75%)**.

This is collection-read traffic only. Normal pack saving remains one RPC, with no added polling or pack-save request. Daily request and byte-egress impact cannot be inferred without active-session weighting, collection-load frequency, and PostgREST response-byte telemetry.

## Capacity and redesign options

No option below was implemented.

| Option | Benefit / expected saving | Complexity | Integrity risk | Rollback difficulty | Request/egress impact | Horizon / decision |
|---|---|---|---|---|---|---|
| Daily capacity monitoring | No direct saving; prevents surprise exhaustion | Low | Low | Easy | Small read-only operational traffic | **Immediate, low risk** |
| Additional disk | Buys time; does not reduce writes | Low operationally | Low data-integrity risk; spend/downsizing risk | Medium | None | **Immediate approval candidate** |
| Preserve compact future collection writes | Prevents repeated metadata from returning | Low | Low | Easy | None | **Already achieved** |
| Skip unchanged price updates | Mostly WAL/CPU reduction; permanent saving likely small | Medium | Medium freshness/semantic risk | Medium | Must not add upstream API calls | Instrument first |
| Full SHA-256 `bytea` idempotency key alongside text | Theoretical heap saving about 47.35 B/pack, roughly 1.93 MiB/day at the 24-hour surge; index saving unbenchmarked | Medium/high migration | Medium/high exact-once risk | Hard; dual-read/write bridge required | Dual-write temporarily increases writes | Clone benchmark and explicit approval |
| Archive historical pack-event detail while retaining permanent receipts | Existing event relation 63.99 MiB; future event component about 16.96 MiB/day at surge if detail stopped remaining hot | High | High: support, rate-limit, recovery, welcome, replay interactions | Hard; restore and stale-client drills required | Archive retrieval adds latency/egress | Architectural approval only |
| Date partitioning | 0 B by itself; enables later approved retention | High | High uniqueness/idempotency and migration risk | Hard | Query-plan risk | Not a capacity fix alone |
| Aggregate counters plus historical-event retention | Potentially similar future event-detail saving; counters already exist and are tiny | High | High loss of recovery/support detail | Very hard | Could reduce reads but archive retrieval adds egress | Product/security approval only |
| Collection index redesign | Candidate index is 22.66 MiB and grows materially, but has 1.19m scans and a live identity contract | Medium/high | High upsert/scanner/latency risk | Hard | No request change; possible latency regression | Not currently safe |
| Controlled receipt/event deletion | Potential saving depends on cutoff | High | **Unacceptable without replacement replay proof** | Very hard | Recovery/support/archive effects | Explicit approval only; receipts remain permanent |

Current event rows eligible by age are still limited:

- older than 7 days: 28,188 rows, modeled 11.19 MiB
- older than 14 days: 18,499 rows, modeled 7.35 MiB
- older than 30 days: 1,810 rows, modeled 0.72 MiB

A conventional 30-day archive therefore has negligible immediate benefit today, even though reducing future event-detail growth could later become material.

### Immediate safe improvements

1. Record daily database, relation, disk, accepted-pack, novelty, bytes/pack, WAL, bloat, and backup snapshots.
2. Alert on both utilization and modeled time-to-threshold.
3. Preserve the current compact collection write shape and protected exact-once indexes.
4. Instrument changed-versus-unchanged price sync behavior before changing freshness semantics.
5. Obtain operational approval for temporary disk headroom before the surge model enters the action window.

### Medium-risk changes requiring a separate approval gate

1. Clone-benchmark a full SHA-256 binary idempotency key with collision-safe dual read/write and reversible cutover.
2. Design set-level price freshness before skipping unchanged row updates.
3. Review the pre-reset backup table for checksummed export and restore testing; its maximum current saving is only 3.21 MiB.
4. Consider any index change only after complete caller inventory and representative query-plan regression tests.

### High-risk architectural changes requiring explicit approval

1. Historical pack-event archival or retention.
2. Event-table partitioning.
3. Replacing event detail with aggregate counters.
4. Any rewrite, remap, deletion, or compaction of collection or permanent idempotency records.

### Not currently justified

- rewriting 2.64 MiB of historical card metadata
- deleting protected receipts, events, collection rows, or idempotency records
- deleting the 3.21 MiB pre-reset backup without export/checksum/restore approval
- blocking `VACUUM FULL` or broad reindexing for about 11.05 MiB estimated bloat
- dropping small achievement or price indexes to address a tens-of-MiB/day slope
- partitioning without an approved retention and global-uniqueness design

## Temporary capacity safeguard

To remain below 70% utilization under the trailing-24-hour surge model, estimated total disk targets are:

- 30 days: about **3.57 GB**
- 60 days: about **6.36 GB**
- 90 days: about **9.14 GB**

A **10 GB total disk target** is the defensible temporary 90-day surge safeguard while a replay-preserving redesign is specified, benchmarked, reviewed, and made reversible. This is a spend/operations decision requiring explicit approval; no resize was performed.

## Backups and recovery evidence

At 2026-08-03 14:49:50Z, WAL-G backups were enabled and PITR was disabled. Nine physical backups were listed; the latest three reported `COMPLETED` at 2026-08-03 14:41:06Z, 2026-08-02 23:04:30Z, and 2026-08-02 14:40:54Z. Backup byte size was not exposed and no non-production restore was performed, so this report does not claim that recoverability was exercised.

## Monitoring recommendations

- **Warning:** disk utilization above 60%, or modeled time to 80% below 90 days.
- **Action:** utilization above 70%, time to 80% below 60 days, or a seven-day normalized slope more than 20% above its preceding four-week baseline.
- **Emergency capacity gate:** utilization above 80–85%, time to 80% below 30 days, disk-pressure autovacuum failures, or backup failures.
- Track daily: `pg_database_size`; heap/index/TOAST for the three core relations and `card_prices`; accepted normal/special events; new collection identities; bytes/accepted pack; pagination GET counts and response bytes; price rows changed/unchanged; WAL rate; dead tuples; autovacuum/analyze timestamps; backup success; provisioned disk and utilization.

## Acceptance statement

- Production database mutations: **0**
- Protected rows deleted or altered: **0**
- Schema, grants, RLS, RPC, pagination, persistence, retention, and index changes: **0**
- Space recovered: **0 B**
- Request or egress behavior changed by this capacity audit: **none**

The immediate issue is capacity headroom, not a proven safe deletion. The safe near-term response is monitoring plus additional disk approval while compact idempotency, archival, retention, partitioning, and index alternatives are separately designed and tested without weakening replay protection.
