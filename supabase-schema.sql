create extension if not exists "pgcrypto";

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_date date not null,
  folder_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null check (category in ('report', 'attendance', 'photos')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  created_at timestamptz not null default now()
);

create index if not exists event_files_event_id_idx on public.event_files(event_id);
create index if not exists event_files_category_idx on public.event_files(category);

alter table public.events enable row level security;
alter table public.event_files enable row level security;

create policy "Service role can manage events"
on public.events
for all
to service_role
using (true)
with check (true);

create policy "Service role can manage event files"
on public.event_files
for all
to service_role
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('event-files', 'event-files', false)
on conflict (id) do nothing;

create policy "Service role can manage event storage"
on storage.objects
for all
to service_role
using (bucket_id = 'event-files')
with check (bucket_id = 'event-files');
