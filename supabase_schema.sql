-- ============================================================
--  FINANZAS PERSONALES · Esquema Supabase (Postgres) · v2
--  Cambios v2: fecha con hora (timestamptz) + subcategorías
--  Ejecutar en: Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) CATEGORÍAS (con jerarquía: padre_id) --------------------
create table if not exists categorias (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  tipo        text not null check (tipo in ('gasto','ingreso')),
  color       text default '#888888',
  emoji       text default '💸',
  padre_id    bigint references categorias(id) on delete cascade,  -- NULL = categoría principal
  creado_en   timestamptz default now()
);

create index if not exists idx_cat_padre on categorias (padre_id);

-- 2) TRANSACCIONES (fecha = día + hora) ----------------------
create table if not exists transacciones (
  id           bigint generated always as identity primary key,
  fecha        timestamptz not null default now(),   -- guarda día Y hora
  importe      numeric(12,2) not null check (importe > 0),
  tipo         text not null check (tipo in ('gasto','ingreso')),
  categoria_id bigint references categorias(id) on delete set null,  -- puede ser categoría o subcategoría
  descripcion  text,
  origen       text default 'manual',   -- 'manual' o 'telegram' (Fase 3)
  creado_en    timestamptz default now()
);

create index if not exists idx_tx_fecha     on transacciones (fecha desc);
create index if not exists idx_tx_categoria on transacciones (categoria_id);

-- 3) PRESUPUESTOS MENSUALES (opcional) -----------------------
create table if not exists presupuestos (
  id           bigint generated always as identity primary key,
  categoria_id bigint references categorias(id) on delete cascade,
  limite_mes   numeric(12,2) not null check (limite_mes >= 0),
  unique (categoria_id)
);

-- 4) CATEGORÍAS PRINCIPALES POR DEFECTO ----------------------
insert into categorias (nombre, tipo, color, emoji) values
  ('Comida',        'gasto',   '#ef4444', '🍔'),
  ('Supermercado',  'gasto',   '#f97316', '🛒'),
  ('Transporte',    'gasto',   '#eab308', '🚗'),
  ('Vivienda',      'gasto',   '#3b82f6', '🏠'),
  ('Ocio',          'gasto',   '#a855f7', '🎉'),
  ('Salud',         'gasto',   '#14b8a6', '💊'),
  ('Suscripciones', 'gasto',   '#ec4899', '📱'),
  ('Compras',       'gasto',   '#6366f1', '🛍️'),
  ('Otros gastos',  'gasto',   '#64748b', '💸'),
  ('Nómina',        'ingreso', '#22c55e', '💼'),
  ('Otros ingresos','ingreso', '#16a34a', '💰')
on conflict (nombre) do nothing;

-- 5) SUBCATEGORÍAS DE COMIDA (ejemplo a afinar) --------------
insert into categorias (nombre, tipo, color, emoji, padre_id)
select v.nombre, 'gasto', v.color, v.emoji,
       (select id from categorias where nombre = 'Comida' and padre_id is null)
from (values
  ('Restaurante',     '#f43f5e', '🍽️'),
  ('Comida con Silvia','#fb7185', '💑'),
  ('Comida en casa',  '#fda4af', '🏡')
) as v(nombre, color, emoji)
on conflict (nombre) do nothing;

-- 6) SEGURIDAD (RLS) -----------------------------------------
alter table categorias    enable row level security;
alter table transacciones enable row level security;
alter table presupuestos  enable row level security;

create policy "acceso_total_categorias"    on categorias    for all using (true) with check (true);
create policy "acceso_total_transacciones" on transacciones for all using (true) with check (true);
create policy "acceso_total_presupuestos"  on presupuestos  for all using (true) with check (true);

-- ============================================================
--  NOTA: si ya habías ejecutado la v1, en vez de recrear corre
--  solo esto para migrar sin perder datos:
--
--    alter table categorias    add column if not exists padre_id bigint references categorias(id) on delete cascade;
--    alter table transacciones alter column fecha type timestamptz using fecha::timestamptz;
--    -- y luego el bloque 5) de subcategorías.
-- ============================================================
