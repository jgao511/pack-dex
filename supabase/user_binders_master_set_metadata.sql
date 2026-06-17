alter table public.user_binders
  add column if not exists type text not null default 'custom',
  add column if not exists set_id text,
  add column if not exists theme text not null default 'midnight';

alter table public.user_binders
  drop constraint if exists user_binders_type_check;

alter table public.user_binders
  add constraint user_binders_type_check
  check (type in ('custom', 'master_set'));

create unique index if not exists user_binders_unique_master_set_idx
  on public.user_binders(user_id, set_id)
  where type = 'master_set' and set_id is not null;
