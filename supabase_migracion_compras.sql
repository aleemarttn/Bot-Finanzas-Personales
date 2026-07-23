-- ============================================================
--  PRÓXIMAS COMPRAS (lista de deseos con cola de prioridad)
--  Ejecutar en: Supabase > SQL Editor > New query > Run
-- ============================================================
--  Diferencia con proximos_gastos:
--    · proximos_gastos  = obligaciones con fecha (IBI, seguro…)  -> se ordenan por FECHA
--    · compras_deseadas = caprichos sin fecha fija               -> se ordenan por PRIORIDAD (orden)
-- ============================================================

create table if not exists compras_deseadas (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  precio         numeric(12,2) not null check (precio >= 0),
  ahorrado       numeric(12,2) not null default 0 check (ahorrado >= 0),
  orden          int not null default 0,        -- posición en la cola: 0 = lo primero que quiero
  categoria_id   bigint references categorias(id) on delete set null,
  fecha_objetivo date,                          -- opcional: "lo quiero para…"
  emoji          text default '🛍️',
  creado_en      timestamptz default now()
);

create index if not exists idx_compras_orden on compras_deseadas (orden);

alter table compras_deseadas enable row level security;

drop policy if exists "acceso_total_compras_deseadas" on compras_deseadas;
create policy "acceso_total_compras_deseadas" on compras_deseadas for all using (true) with check (true);
