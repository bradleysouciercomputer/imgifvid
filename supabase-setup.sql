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

-- Public user profiles, editable only by the profile owner.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Member'
    check (char_length(display_name) between 1 and 32 and char_length(trim(display_name)) > 0),
  bio text not null default ''
    check (char_length(bio) <= 280),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_avatar_owner_path_check
    check (avatar_path is null or avatar_path like (id::text || '/%'))
);

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
create policy "Public profiles are viewable by everyone"
  on public.profiles for select to anon, authenticated using (true);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

insert into public.profiles (id, display_name)
select
  u.id,
  left(coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Member'
  ), 32)
from auth.users u
on conflict (id) do nothing;

create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Member'
    ), 32)
  )
  on conflict (id) do nothing;
  return new;
end;
$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_profile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their own avatars" on storage.objects;
create policy "Users upload their own avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users delete their own avatars" on storage.objects;
create policy "Users delete their own avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Comments belong to a single post and are removed automatically with it.
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.media_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000 and char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_created_idx
  on public.post_comments (post_id, created_at desc);
create index if not exists post_comments_user_created_idx
  on public.post_comments (user_id, created_at desc);

alter table public.post_comments enable row level security;

drop policy if exists "Anyone can read post comments" on public.post_comments;
create policy "Anyone can read post comments"
  on public.post_comments for select
  to anon, authenticated
  using (true);

drop policy if exists "Members can comment as themselves" on public.post_comments;
create policy "Members can comment as themselves"
  on public.post_comments for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Members can delete their own comments" on public.post_comments;
create policy "Members can delete their own comments"
  on public.post_comments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.post_comments to anon, authenticated;
grant insert, delete on public.post_comments to authenticated;

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

drop policy if exists "Members can list their own media files" on storage.objects;
create policy "Members can list their own media files"
  on storage.objects for select
  to authenticated
  using (
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