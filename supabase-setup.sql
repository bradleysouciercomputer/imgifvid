-- imgifvid media gallery schema.
-- This setup has already been applied to the imgifvid Supabase project.
-- Public media URLs are intentional: do not upload private or sensitive files.

create table if not exists public.media_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled media'
    check (char_length(title) between 1 and 120),
  description text not null default ''
    check (char_length(description) <= 500),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  media_kind text not null check (media_kind in ('image', 'gif', 'video')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 104857600),
  created_at timestamptz not null default now()
);

alter table public.media_posts
  drop constraint if exists media_posts_storage_path_owner_check;
alter table public.media_posts
  add constraint media_posts_storage_path_owner_check
  check (storage_path like (user_id::text || '/%'));

create index if not exists media_posts_created_at_idx
  on public.media_posts (created_at desc);
create index if not exists media_posts_kind_created_at_idx
  on public.media_posts (media_kind, created_at desc);
create index if not exists media_posts_user_created_at_idx
  on public.media_posts (user_id, created_at desc);

alter table public.media_posts enable row level security;

drop policy if exists "Anyone can read media posts" on public.media_posts;
create policy "Anyone can read media posts"
  on public.media_posts for select
  to anon, authenticated
  using (true);

drop policy if exists "Members can create their own media posts" on public.media_posts;
create policy "Members can create their own media posts"
  on public.media_posts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Members can delete their own media posts" on public.media_posts;
create policy "Members can delete their own media posts"
  on public.media_posts for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.media_posts to anon, authenticated;
grant insert, delete on public.media_posts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members upload into their own media folder" on storage.objects;
create policy "Members upload into their own media folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Members delete files in their own media folder" on storage.objects;
create policy "Members delete files in their own media folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );