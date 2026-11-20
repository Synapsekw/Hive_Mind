-- Hive Mind: core schema.
-- Every row belongs to one hive. Notes live in a member's workspace and are
-- private until the member shares them. Sharing rules are in the next migration.

create type public.visibility as enum ('private', 'group', 'members');
create type public.member_role as enum ('owner', 'member');
create type public.trust_tier as enum ('vendor', 'self_hosted');
create type public.link_status as enum ('proposed', 'accepted', 'declined');
create type public.entity_type as enum ('client', 'project', 'person', 'product');

create table public.hives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  role public.member_role not null default 'member',
  -- What a note gets when neither it nor its folder says otherwise.
  default_visibility public.visibility not null default 'private'
    check (default_visibility <> 'members'),
  created_at timestamptz not null default now(),
  unique (hive_id, user_id)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (member_id, name)
);

-- One row per connected agent. The token is shown once and stored as a hash.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  provider text not null,
  trust_tier public.trust_tier not null default 'vendor',
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  path text not null,
  -- null means "inherit the member's default".
  visibility public.visibility,
  shared_with uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, path)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  folder_id uuid references public.folders on delete set null,
  path text not null,
  title text not null,
  frontmatter jsonb not null default '{}',
  body text not null default '',
  -- null means "inherit from the folder, then the member's default".
  visibility public.visibility,
  shared_with uuid[] not null default '{}',
  -- Held for the owner's review; invisible to everyone else while true.
  quarantined boolean not null default false,
  version integer not null default 1,
  written_by_agent uuid references public.agents on delete set null,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, path)
);
create index notes_search_idx on public.notes using gin (search);
create index notes_hive_idx on public.notes (hive_id);
create index notes_member_idx on public.notes (member_id);
create index notes_folder_idx on public.notes (folder_id);

create table public.note_versions (
  note_id uuid not null references public.notes on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  frontmatter jsonb not null,
  written_by_agent uuid references public.agents on delete set null,
  written_at timestamptz not null default now(),
  primary key (note_id, version)
);

-- A file is shared exactly like the note it is attached to.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  note_id uuid references public.notes on delete set null,
  storage_path text not null unique,
  name text not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index files_note_idx on public.files (note_id);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  type public.entity_type not null,
  canonical_name text not null,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (hive_id, type, canonical_name)
);

create table public.note_entities (
  note_id uuid not null references public.notes on delete cascade,
  entity_id uuid not null references public.entities on delete cascade,
  confidence real not null default 1,
  confirmed_by uuid references public.members on delete set null,
  primary key (note_id, entity_id)
);
create index note_entities_entity_idx on public.note_entities (entity_id);

-- A link between two notes. Tier 1 is the strongest (same client or project),
-- tier 4 the weakest (similar text). It only counts once both owners accept.
create table public.links (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  from_note uuid not null references public.notes on delete cascade,
  to_note uuid not null references public.notes on delete cascade,
  tier smallint not null check (tier between 1 and 4),
  score real not null check (score >= 0 and score <= 1),
  status public.link_status not null default 'proposed',
  from_accepted_at timestamptz,
  to_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (from_note, to_note),
  check (from_note <> to_note)
);
create index links_to_idx on public.links (to_note);

create table public.synthesis_pages (
  entity_id uuid primary key references public.entities on delete cascade,
  hive_id uuid not null references public.hives on delete cascade,
  body text not null default '',
  sources jsonb not null default '[]',
  contradictions jsonb not null default '[]',
  rebuilt_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid not null references public.members on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_member_idx on public.notifications (member_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  hive_id uuid not null references public.hives on delete cascade,
  member_id uuid references public.members on delete set null,
  agent_id uuid references public.agents on delete set null,
  action text not null,
  note_id uuid,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_log_hive_idx on public.audit_log (hive_id, at desc);
