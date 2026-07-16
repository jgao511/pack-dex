# PackDex account-deletion data audit

This audit is based on the checked-in Supabase schema and Edge Functions as of 2026-07-16. The `delete-account` Edge Function authenticates the current request, calls the transactional `delete_packdex_account_data` procedure for that authenticated ID, then removes the Supabase Auth user last. The client never receives a service-role key and never supplies a target user ID.

## Dependency map

```text
auth.users
├─ user_collection
├─ user_collection_increment_events
├─ user_scanner_card_additions
├─ user_welcome_rewards
├─ user_achievements
├─ user_binders
├─ user_pack_open_events
├─ user_profile_stats
└─ user_wishlist
```

Each listed table has a foreign key to `auth.users(id)` with `ON DELETE CASCADE`. The procedure also deletes each row explicitly before the Auth deletion, so application data deletion is transactional and the foreign keys provide a safety net for the final Auth deletion.

No user-profile table, storage-bucket definition, or user-generated-content table beyond the tables listed above was found in the checked-in Supabase schema or client/Edge Function queries.

## Deletion decisions

| Data | Decision | Reason |
| --- | --- | --- |
| `user_collection` | Delete | Account-owned virtual card collection. |
| `user_collection_increment_events` | Delete | Account-owned collection idempotency receipts. |
| `user_scanner_card_additions` | Delete | Account-owned one-time scanner-add receipts. |
| `user_welcome_rewards` | Delete | Account-specific reward and claim state. |
| `user_achievements` | Delete | Account-owned achievements and progress metadata. |
| `user_binders` | Delete | Account-owned binder names, themes, and card placements. |
| `user_pack_open_events` | Delete | Account-owned pack opening history. |
| `user_profile_stats` | Delete | Account-owned aggregate statistics. |
| `user_wishlist` | Delete | Account-owned saved wishlist entries. |
| `public_pull_shares` | Retain until its existing expiry | The current schema does not contain an owner/user ID; shares are anonymous public records and cannot be connected to a deleted account. |
| `public_pull_share_rate_limits` | Retain for its existing two-day cleanup | It contains rate-limit subjects rather than PackDex account IDs and is not account-owned. |
| `card_prices` | Retain | Shared catalog/price data, not user data. |

The obsolete `shared_pack_pulls` table was dropped by migration `20260711023000_drop_abandoned_shared_pack_pulls.sql`; it is not part of the current schema.

## Client cleanup

After server confirmation, both web and mobile clear PackDex local collection, binder, preference, welcome-state, and pending account-pull keys, while preserving scanner tips because they are device-wide rather than account-specific. Supabase local session storage is cleared through a local sign-out and application state returns to a clean guest screen.

## Privacy-policy updates to make before release

Add a concise account-deletion section that states:

1. Signed-in users can start permanent deletion from Profile > Settings > Delete Account and must type `DELETE` to confirm.
2. Deletion removes Supabase Auth credentials and the PackDex data listed as deleted above; public anonymous pull shares remain available only until their configured expiry because they are not linked to an account.
3. The in-app action completes after the server confirms the request; explain any operational backup retention period if Supabase or Cloudflare backups retain data outside the live system.
4. Supabase processes authentication and database data, Cloudflare processes delivery/security data where used, and any analytics or logging vendor must be named with its retention period before production release.
