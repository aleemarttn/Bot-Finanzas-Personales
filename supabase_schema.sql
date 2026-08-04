-- ============================================================
--  FINANZAS PERSONALES · Esquema Supabase (Postgres) · v4
--  Esquema completo: las 6 tablas que usa el dashboard.
--  RLS por usuario (login real, desde 2026-08-03): cada tabla
--  lleva user_id uuid = auth.uid() y una política "propietario".
--  Idempotente: se puede ejecutar varias veces sin duplicar.
--  Ejecutar en: Supabase > SQL Editor > New query > Run
-- ============================================================

-- 1) CATEGORÍAS (con jerarquía: padre_id) --------------------
create table if not exists categorias (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  tipo        text not null check (tipo in ('gasto','ingreso')),
  color       text default '#888888',
  emoji       text default '💸',
  padre_id    bigint references categorias(id) on delete cascade,  -- NULL = categoría principal
  creado_en   timestamptz default now(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade
);

alter table categorias add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;
alter table categorias drop constraint if exists categorias_nombre_key;
alter table categorias drop constraint if exists categorias_user_nombre_key;
alter table categorias add constraint categorias_user_nombre_key unique (user_id, nombre);

create index if not exists idx_cat_padre on categorias (padre_id);

-- 2) TRANSACCIONES (fecha = día + hora) ----------------------
create table if not exists transacciones (
  id           bigint generated always as identity primary key,
  fecha        timestamptz not null default now(),   -- guarda día Y hora
  importe      numeric(12,2) not null check (importe > 0),
  tipo         text not null check (tipo in ('gasto','ingreso')),
  categoria_id bigint references categorias(id) on delete set null,  -- puede ser categoría o subcategoría
  descripcion  text,
  origen       text default 'manual',   -- 'manual' o 'telegram'
  creado_en    timestamptz default now(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade
);

alter table transacciones add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;

create index if not exists idx_tx_fecha     on transacciones (fecha desc);
create index if not exists idx_tx_categoria on transacciones (categoria_id);

-- 3) PRESUPUESTOS MENSUALES (opcional) -----------------------
create table if not exists presupuestos (
  id           bigint generated always as identity primary key,
  categoria_id bigint references categorias(id) on delete cascade,
  limite_mes   numeric(12,2) not null check (limite_mes >= 0),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unique (categoria_id)
);

alter table presupuestos add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;

-- 4) CATEGORÍAS MADRE ----------------------------------------
--    Cada familia tiene su color; las subcategorías van en tonos
--    del mismo color para que el donut se lea de un vistazo.
insert into categorias (nombre, tipo, color, emoji) values
  ('Comida',        'gasto',   '#ef4444', '🍔'),
  ('Coche',         'gasto',   '#eab308', '🚗'),
  ('Vivienda',      'gasto',   '#3b82f6', '🏠'),
  ('Ocio',          'gasto',   '#a855f7', '🎉'),
  ('Salud',         'gasto',   '#14b8a6', '💊'),
  ('Suscripciones', 'gasto',   '#ec4899', '📱'),
  ('Compras',       'gasto',   '#6366f1', '🛍️'),
  ('Deporte',       'gasto',   '#06b6d4', '🏃'),
  ('Educación',     'gasto',   '#84cc16', '🎓'),
  ('Otros gastos',  'gasto',   '#64748b', '💸'),
  ('Nómina',        'ingreso', '#22c55e', '💼'),
  ('Otros ingresos','ingreso', '#16a34a', '💰')
on conflict (user_id, nombre) do nothing;

-- 5) SUBCATEGORÍAS -------------------------------------------
--    Todo lo que es comer cuelga de Comida, Supermercado incluido.
insert into categorias (nombre, tipo, color, emoji, padre_id)
select v.nombre, v.tipo, v.color, v.emoji,
       (select id from categorias c where c.nombre = v.padre and c.padre_id is null and c.user_id = auth.uid())
from (values
  ('Comida con Silvia',  'gasto',   '#fca5a5', '💑', 'Comida'),
  ('Restaurantes',       'gasto',   '#f87171', '🍽️', 'Comida'),
  ('Comida del trabajo', 'gasto',   '#b91c1c', '🏷️', 'Comida'),
  ('Supermercado',       'gasto',   '#dc2626', '🛒', 'Comida'),
  ('Gasolina',           'gasto',   '#fbbf24', '⛽', 'Coche'),
  ('Taller',             'gasto',   '#ca8a04', '🔧', 'Coche'),
  ('Mantenimiento',      'gasto',   '#d97706', '🛠',  'Coche'),
  ('Peluquería',         'gasto',   '#2dd4bf', '💇', 'Salud'),
  ('Dinero padre',       'ingreso', '#4ade80', '👨‍👦', 'Otros ingresos'),
  ('Ingreso extra',      'ingreso', '#15803d', '✨', 'Otros ingresos'),
  ('Bizum',              'ingreso', '#34d399', '📲', 'Otros ingresos')
) as v(nombre, tipo, color, emoji, padre)
on conflict (user_id, nombre) do nothing;

-- 6) AJUSTES (objetivos de ahorro y saldo inicial) -----------
--    Tabla clave/valor que lee el dashboard: objetivo_mensual,
--    objetivo_acumulado, saldo_inicial. Clave por usuario, no global.
create table if not exists ajustes (
  clave   text not null,
  valor   numeric not null default 0,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (user_id, clave)
);

alter table ajustes add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;
alter table ajustes drop constraint if exists ajustes_pkey;
alter table ajustes add constraint ajustes_pkey primary key (user_id, clave);

-- 7) PRÓXIMOS GASTOS (obligaciones con fecha) ----------------
--    IBI, seguro del coche… se ordenan por FECHA.
create table if not exists proximos_gastos (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  importe      numeric(12,2) not null default 0,
  fecha        date not null,
  categoria_id bigint references categorias(id) on delete set null,
  creado_en    timestamptz default now(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade
);

alter table proximos_gastos add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;

-- 8) COMPRAS DESEADAS (lista de deseos) ----------------------
--    Caprichos sin fecha fija: se ordenan por PRIORIDAD (orden)
--    y el dashboard calcula cuándo podrás permitírtelos.
create table if not exists compras_deseadas (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  precio         numeric(12,2) not null check (precio >= 0),
  ahorrado       numeric(12,2) not null default 0 check (ahorrado >= 0),
  orden          int not null default 0,        -- 0 = lo primero que quiero
  categoria_id   bigint references categorias(id) on delete set null,
  fecha_objetivo date,                          -- opcional: "lo quiero para…"
  emoji          text default '🛍️',
  creado_en      timestamptz default now(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade
);

alter table compras_deseadas add column if not exists user_id uuid not null default auth.uid() references auth.users(id) on delete cascade;

create index if not exists idx_compras_orden on compras_deseadas (orden);

-- 9) SEGURIDAD (RLS) -------------------------------------------
--    Login real con Supabase Auth: cada tabla queda restringida a
--    su propio dueño (auth.uid() = user_id). Si ejecutas los INSERT
--    de arriba desde el SQL Editor, corren como rol postgres y
--    auth.uid() es NULL: hazlo autenticado (o via la app) para que
--    las categorías por defecto queden asignadas a tu usuario.
alter table categorias       enable row level security;
alter table transacciones    enable row level security;
alter table presupuestos     enable row level security;
alter table ajustes          enable row level security;
alter table proximos_gastos  enable row level security;
alter table compras_deseadas enable row level security;

drop policy if exists "acceso_total_categorias"       on categorias;
drop policy if exists "acceso_total_transacciones"    on transacciones;
drop policy if exists "acceso_total_presupuestos"     on presupuestos;
drop policy if exists "acceso_total_ajustes"          on ajustes;
drop policy if exists "acceso_total_proximos_gastos"  on proximos_gastos;
drop policy if exists "acceso_total_compras_deseadas" on compras_deseadas;

drop policy if exists "propietario" on categorias;
drop policy if exists "propietario" on transacciones;
drop policy if exists "propietario" on presupuestos;
drop policy if exists "propietario" on ajustes;
drop policy if exists "propietario" on proximos_gastos;
drop policy if exists "propietario" on compras_deseadas;

create policy "propietario" on categorias       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "propietario" on transacciones    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "propietario" on presupuestos     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "propietario" on ajustes          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "propietario" on proximos_gastos  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "propietario" on compras_deseadas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
