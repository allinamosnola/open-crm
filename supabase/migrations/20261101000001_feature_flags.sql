-- Feature flags (Fase 5 del plan de brecha 2026-10-12): encender una función
-- nueva por cuenta sin redeploy, sin proveedor externo.
--   * Una fila con account_id null es el valor global del flag; una fila con
--     account_id es la excepción de esa cuenta y gana sobre la global.
--   * Sin filas, el flag está apagado: toda función nueva se despliega apagada.
--   * Las administra el dueño del SaaS con la service role (scripts/set-flag.ts),
--     igual que accounts. La tabla no tiene políticas: el personal no la lee ni
--     la escribe; consulta solo el valor resuelto con my_feature_enabled().

create table public.feature_flags (
  id         uuid primary key default gen_random_uuid(),
  -- Nombre en snake_case (p. ej. 'pdf_documents'); los conoce src/lib/flags.ts.
  flag       text not null check (flag ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- null = valor global del flag.
  account_id uuid references public.accounts (id) on delete cascade,
  enabled    boolean not null,
  -- Motivo o ticket (p. ej. «cuenta piloto»), para quien lo revise después.
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un valor global y uno por cuenta como máximo (null cuenta como valor).
  constraint feature_flags_flag_account_key unique nulls not distinct (flag, account_id)
);

create index feature_flags_account_id_idx on public.feature_flags (account_id);

create or replace function public.feature_flags_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.feature_flags_touch() from public, anon, authenticated;

create trigger feature_flags_touch
  before update on public.feature_flags
  for each row execute function public.feature_flags_touch();

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Valor resuelto: excepción de la cuenta > valor global > apagado.
-- ---------------------------------------------------------------------------
create or replace function public.feature_enabled(p_flag text, p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.enabled from public.feature_flags f
      where f.flag = p_flag and f.account_id = p_account_id),
    (select f.enabled from public.feature_flags f
      where f.flag = p_flag and f.account_id is null),
    false
  )
$$;

-- Solo el servidor (service role): recibe cualquier account_id.
revoke execute on function public.feature_enabled(text, uuid) from public, anon, authenticated;
grant execute on function public.feature_enabled(text, uuid) to service_role;

-- Valor del flag para la cuenta del consultorio activo del usuario. Sin
-- membresía activa devuelve false. Nunca expone flags de otra cuenta.
create or replace function public.my_feature_enabled(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.feature_enabled(p_flag, c.account_id)
       from public.clinics c
      where c.id = public.current_clinic_id()),
    false
  )
$$;

revoke execute on function public.my_feature_enabled(text) from public, anon;
grant execute on function public.my_feature_enabled(text) to authenticated, service_role;
