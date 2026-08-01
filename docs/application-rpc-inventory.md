# Application RPC inventory

| RPC | Callers | Roles | Arguments / return | Retry and status |
| --- | --- | --- | --- | --- |
| `increment_collection_cards` | Shared completed-pack queue used by desktop and mobile | `authenticated` only | One JSONB batch; collection rows plus acceptance and stats | Required; idempotent by `(user_id, client_event_id)`; transient retries only |
| `get_public_packdex_stats` | Public PackDex statistics loader | Public roles defined by its migration | No private target user; aggregate result | Read-only and safe to retry |
| `add_scanned_card_once` | Private/demo Android scanner action module | `authenticated` | Set/card IDs; scanner receipt | Idempotent scanner-only write; never records pack events |
| `delete_packdex_account_data` | Authenticated delete-account Edge Function using its trusted client | Trusted server role | Authenticated user ID bound by server | Destructive and intentionally not retried automatically |
| `complete_mobile_onboarding_v1` | Complete-mobile-onboarding Edge Function | Trusted server role | Stable onboarding payload | Transactional and idempotent by onboarding receipt |
| `consume_public_pull_share_rate_limit` | Pull-share and price-refresh Edge Functions | Trusted server role | Rate-limit key/window | Controlled boolean result; safe only as part of one server request |

The retired event-only function remains solely because applied migration history and trusted recovery tooling reference its signature. `public`, `anon`, and `authenticated` have no execute privilege, and production client code has no caller or fallback for it. The `record-pack-open` Edge Function is a non-writing HTTP 410 tombstone for stale clients.

Direct server-owned writes to `user_pack_open_events` are limited to the onboarding/welcome-reward transactions. They are intentionally separate from normal pack opening. Account deletion may delete those rows as part of the authenticated full-account deletion transaction.
