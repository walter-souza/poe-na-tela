-- ==============================================================================
-- PÕE NA TELA — SCHEMA INICIAL DO SUPABASE (DISCORD-LIKE EVOLUTION)
-- ==============================================================================
-- Execute este script no SQL Editor do seu projeto Supabase.

-- 1. EXTENSÕES
create extension if not exists "uuid-ossp";

-- 2. TABELA DE PERFIS (PROFILES)
-- Extensão da tabela auth.users do Supabase
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text not null,
  avatar_url text,
  is_guest boolean default false,
  created_at timestamptz default now()
);

-- Ativar RLS
alter table public.profiles enable row level security;

-- Políticas de RLS para Profiles
create policy "Perfis são visíveis publicamente"
  on public.profiles for select
  using (true);

create policy "Usuários podem atualizar seus próprios perfis"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Usuários podem inserir seu próprio perfil"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 3. TRIGGER AUTOMÁTICO: Criar Profile ao criar auth.user (Google OAuth / Guest)
create or replace function public.handle_new_user()
returns trigger as $$
declare
  raw_username text;
  raw_avatar text;
  raw_is_anonymous boolean;
begin
  raw_is_anonymous := coalesce((new.raw_app_meta_data->>'provider') = 'anonymous', false);
  
  -- Extrair username do Google ou metadata
  raw_username := coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'nickname',
    split_part(new.email, '@', 1),
    'Convidado'
  );
  
  raw_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture',
    null
  );

  insert into public.profiles (id, username, avatar_url, is_guest)
  values (new.id, raw_username, raw_avatar, raw_is_anonymous)
  on conflict (id) do update set
    username = excluded.username,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$ language plpgsql security definer;

-- Trigger disparado após inserção em auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 4. TABELA DE SALAS (ROOMS)
create table if not exists public.rooms (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,
  name text not null,
  encrypted_room_key text not null,          -- Chave AES cifrada pelo KMS do backend
  passcode_hash text,                        -- Hash bcrypt opcional (para salas protegidas)
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.rooms enable row level security;

-- Políticas de RLS para Rooms
create policy "Salas são visíveis para todos"
  on public.rooms for select
  using (true);

create policy "Apenas usuários autenticados reais (não convidados) podem criar salas"
  on public.rooms for insert
  with check (
    auth.role() = 'authenticated' and
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_guest = false
    )
  );

create policy "Apenas o dono da sala pode atualizar a sala"
  on public.rooms for update
  using (auth.uid() = owner_id);

create policy "Apenas o dono da sala pode deletar a sala"
  on public.rooms for delete
  using (auth.uid() = owner_id);


-- 5. TABELA DE MEMBROS DA SALA (ROOM_MEMBERS)
create table if not exists public.room_members (
  room_id uuid references public.rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text default 'member' check (role in ('owner', 'admin', 'member', 'guest')),
  joined_at timestamptz default now(),
  primary key (room_id, user_id)
);

alter table public.room_members enable row level security;

create policy "Membros da sala são visíveis para todos os membros"
  on public.room_members for select
  using (true);

create policy "Membros podem entrar na sala"
  on public.room_members for insert
  with check (auth.uid() = user_id);


-- 6. TABELA DE CANAIS (CHANNELS)
create table if not exists public.channels (
  id uuid default gen_random_uuid() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'voice', 'stream')),
  position int default 0,
  created_at timestamptz default now()
);

alter table public.channels enable row level security;

create policy "Canais são visíveis para todos"
  on public.channels for select
  using (true);

create policy "Apenas o dono da sala pode gerenciar canais"
  on public.channels for insert
  with check (
    exists (
      select 1 from public.rooms
      where id = room_id and owner_id = auth.uid()
    )
  );

create policy "Apenas o dono da sala pode editar canais"
  on public.channels for update
  using (
    exists (
      select 1 from public.rooms
      where id = room_id and owner_id = auth.uid()
    )
  );

create policy "Apenas o dono da sala pode deletar canais"
  on public.channels for delete
  using (
    exists (
      select 1 from public.rooms
      where id = room_id and owner_id = auth.uid()
    )
  );


-- 7. TABELA DE MENSAGENS CIFRADAS (MESSAGES)
create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  channel_id uuid references public.channels(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  ciphertext text not null,                  -- Texto cifrado AES-256 no navegador
  iv text not null,                          -- IV em base64/hex
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy "Qualquer pessoa na sala pode ver mensagens"
  on public.messages for select
  using (true);

create policy "Qualquer pessoa pode enviar mensagens"
  on public.messages for insert
  with check (true);

-- Ativar Supabase Realtime para a tabela de mensagens e canais
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.channels;
