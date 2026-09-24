create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9._-]{3,32}$'),
  role text not null default 'Usuario' check (role in ('Administrador', 'Usuario')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null default '{"categories":[],"exercises":[],"routines":[],"workouts":[],"activeWorkout":null}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null,
  primary key (user_id, id)
);
create table if not exists public.exercises (
  user_id uuid not null,
  id uuid not null,
  category_id uuid not null,
  name text not null,
  primary key (user_id, id),
  foreign key (user_id, category_id) references public.exercise_categories(user_id, id) on delete cascade
);
create table if not exists public.routines (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  name text not null,
  primary key (user_id, id)
);
create table if not exists public.routine_exercises (
  user_id uuid not null,
  routine_id uuid not null,
  exercise_id uuid not null,
  target_sets integer not null check (target_sets between 1 and 30),
  target_reps integer not null check (target_reps between 1 and 100),
  primary key (user_id, routine_id, exercise_id),
  foreign key (user_id, routine_id) references public.routines(user_id, id) on delete cascade,
  foreign key (user_id, exercise_id) references public.exercises(user_id, id) on delete cascade
);
create table if not exists public.workouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  workout_date date not null,
  routine_name text not null,
  primary key (user_id, id)
);
create table if not exists public.performed_sets (
  user_id uuid not null,
  workout_id uuid not null,
  exercise_id uuid not null,
  exercise_name text not null,
  set_number integer not null check (set_number > 0),
  reps integer not null check (reps > 0),
  weight numeric(8,2) not null check (weight >= 0),
  primary key (user_id, workout_id, exercise_id, set_number),
  foreign key (user_id, workout_id) references public.workouts(user_id, id) on delete cascade
);

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  supplied_username text := new.raw_user_meta_data ->> 'username';
begin
  if supplied_username is null or supplied_username !~ '^[A-Za-z0-9._-]{3,32}$' then
    raise exception 'A valid username is required';
  end if;
  insert into public.profiles(id, username, role) values (new.id, supplied_username, 'Usuario');
  insert into public.user_workspaces(user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_fuerza on auth.users;
create trigger on_auth_user_created_fuerza after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.save_workspace(p_document jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_document -> 'categories') <> 'array'
     or jsonb_typeof(p_document -> 'exercises') <> 'array'
     or jsonb_typeof(p_document -> 'routines') <> 'array'
     or jsonb_typeof(p_document -> 'workouts') <> 'array' then
    raise exception 'Workspace data is invalid';
  end if;

  insert into public.user_workspaces(user_id, document, updated_at)
  values (owner_id, p_document, now())
  on conflict (user_id) do update set document = excluded.document, updated_at = now();

  delete from public.performed_sets where user_id = owner_id;
  delete from public.workouts where user_id = owner_id;
  delete from public.routine_exercises where user_id = owner_id;
  delete from public.routines where user_id = owner_id;
  delete from public.exercises where user_id = owner_id;
  delete from public.exercise_categories where user_id = owner_id;

  insert into public.exercise_categories(user_id, id, name)
  select owner_id, (x ->> 'id')::uuid, x ->> 'name'
  from jsonb_array_elements(p_document -> 'categories') x;

  insert into public.exercises(user_id, id, category_id, name)
  select owner_id, (x ->> 'id')::uuid, (x ->> 'categoryId')::uuid, x ->> 'name'
  from jsonb_array_elements(p_document -> 'exercises') x;

  insert into public.routines(user_id, id, name)
  select owner_id, (x ->> 'id')::uuid, x ->> 'name'
  from jsonb_array_elements(p_document -> 'routines') x;

  insert into public.routine_exercises(user_id, routine_id, exercise_id, target_sets, target_reps)
  select owner_id, (r ->> 'id')::uuid, (i ->> 'exerciseId')::uuid,
         (i ->> 'sets')::integer, (i ->> 'reps')::integer
  from jsonb_array_elements(p_document -> 'routines') r
  cross join lateral jsonb_array_elements(r -> 'items') i;

  insert into public.workouts(user_id, id, workout_date, routine_name)
  select owner_id, (w ->> 'id')::uuid, (w ->> 'date')::date, w ->> 'routineName'
  from jsonb_array_elements(p_document -> 'workouts') w;

  insert into public.performed_sets(user_id, workout_id, exercise_id, exercise_name, set_number, reps, weight)
  select owner_id, (w ->> 'id')::uuid, (e ->> 'exerciseId')::uuid, e ->> 'name', s.ordinality::integer,
         (s.value ->> 'reps')::integer, (s.value ->> 'weight')::numeric
  from jsonb_array_elements(p_document -> 'workouts') w
  cross join lateral jsonb_array_elements(w -> 'exercises') e
  cross join lateral jsonb_array_elements(e -> 'sets') with ordinality s(value, ordinality);
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_workspaces enable row level security;
alter table public.exercise_categories enable row level security;
alter table public.exercises enable row level security;
alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.performed_sets enable row level security;

drop policy if exists "read own profile" on public.profiles;
drop policy if exists "manage own workspace" on public.user_workspaces;
drop policy if exists "manage own categories" on public.exercise_categories;
drop policy if exists "manage own exercises" on public.exercises;
drop policy if exists "manage own routines" on public.routines;
drop policy if exists "manage own routine exercises" on public.routine_exercises;
drop policy if exists "manage own workouts" on public.workouts;
drop policy if exists "manage own performed sets" on public.performed_sets;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "manage own workspace" on public.user_workspaces for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own categories" on public.exercise_categories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own exercises" on public.exercises for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own routines" on public.routines for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own routine exercises" on public.routine_exercises for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own workouts" on public.workouts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "manage own performed sets" on public.performed_sets for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.user_workspaces, public.exercise_categories, public.exercises,
  public.routines, public.routine_exercises, public.workouts, public.performed_sets to authenticated;
grant execute on function public.save_workspace(jsonb) to authenticated;
