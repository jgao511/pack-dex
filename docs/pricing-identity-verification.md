# Pricing identity and marketplace verification

PackDex accepts a market price only when the PackDex card, Pokemon TCG API card, and modeled printing agree. The pricing provider remains Pokemon TCG API v2; TCGplayer product pages are inspected only to verify marketplace identity and finish interpretation.

## Runtime rules

- The exact Pokemon TCG API card ID and API set ID are mandatory. Name and collector number must also agree, except for a documented upstream-number defect that has an exact audited TCGplayer product proof.
- Every accepted market value requires a class `A` exact-product proof in the generated catalog. A wrong or unverifiable redirect can contribute neither a direct link nor collection value.
- Ordinary Common and Uncommon cards use `normal`. Reverse-only values are unavailable unless the catalog explicitly models that reverse printing.
- Inherently holo and special cards prefer `holofoil`.
- A single-printing special card may use its sole positive non-reverse bucket only when the catalog contains the exact audited canonical URL and TCGplayer product ID. The selection reason is `single_verified_non_reverse_bucket`.
- Multiple plausible positive non-reverse buckets remain unavailable without explicit finish metadata.
- Edition-specific buckets remain unavailable unless the catalog explicitly names the edition finish.
- A verified canonical URL is retained when its market is unavailable. Unverified, generic, unreachable, or wrong destinations are withheld so the frontend uses its canonical TCGplayer search fallback.
- Scheduled sync writes successful identity rows before removing stale incorrect rows. Failed upstream sets preserve existing rows and are isolated from successful subsets.

## Freshness

Scheduled jobs run every other day. Frontend prices remain trusted for seven days, which tolerates three missed scheduled runs. After seven days the UI treats the price as unavailable but retains an audited marketplace link. The consumer refresh function's 48-hour server freshness check does not change the seven-day display and valuation policy.

## Full registry audit

Run:

```text
npm run audit:price-registry
```

The resumable audit reads all active cards from `supabase/functions/sync-card-prices/catalog.json`, fetches every mapped Pokemon TCG API set with bounded retries, reads live `card_prices`, follows every canonical redirect, and validates the terminal TCGplayer product identity. It writes:

- a card-level JSONL registry;
- a redirect/product JSONL audit;
- a compact exact-product proof registry;
- verified non-reverse fallback candidates;
- historical quarantine and unmatched-upstream reports;
- before/after and per-set summaries.

URL classifications are:

- `A`: exact verified product;
- `B`: generic/search destination;
- `C`: wrong product or unapproved host;
- `D`: unreachable or redirect loop;
- `E`: unverifiable.

Only class `A` is eligible for `View on TCGplayer`. The audit never copies a price from TCGplayer HTML or its product-page support response.

## Release gates

The desktop App must remain statically imported by `src/main.jsx`; only the welcome page may be lazy. `npm run verify:desktop-bundle` rejects a separate App chunk or an unexpected lazy boundary. `npm run verify:deployment-assets -- --base-url=<origin>` recursively validates served JS/CSS MIME types and requires a non-immutable 404 for a deliberately missing hashed asset.

No scheduler cadence, client polling, collection persistence, pagination, canonical IDs, set membership, authentication, RLS, grants, rate limits, pack generation, pull rates, scanner identity, or service-worker behavior is changed by this pricing policy.
