# Chicha Finanzas · Dashboard

Dashboard estatico (HTML/CSS/JS puro) para visualizar mis finanzas personales.
Los datos viven en Supabase y se registran a mano o via un bot de Telegram + n8n.

## Como funciona

- **index.html**: un unico archivo, tambien PWA instalable en el movil
  (`manifest.webmanifest` + `sw.js` + los tres iconos). Usa supabase-js por
  CDN y las fuentes Onest y Geist Mono de Google Fonts. Sin build ni librerias
  de graficos: barras y reparto se pintan con HTML y CSS.
- **Diseño**: oscuro con acento verde agua (`#4FD8AC`) y coral (`#FF7A66`) para
  alertas. Movil a una columna con boton fijo abajo; a partir de 1000px, panel
  de escritorio. La referencia esta en `design_handoff_chicha_finanzas/`.
- **Datos**: Supabase (Postgres). Hay login real (Supabase Auth) y RLS por
  usuario: cada tabla tiene `user_id` y una politica `propietario`
  (`auth.uid() = user_id`), asi que el front solo ve tus propios datos. Si no
  hay claves arranca en **modo demo** con datos de ejemplo, insignia ambar en
  vez de verde.
- **Bot**: Telegram -> n8n (polling, en el PC con Docker) -> IA (Groq) ->
  Supabase. El dashboard lo ve automaticamente.

## Tablas en Supabase

Las 6 estan en `supabase_schema.sql`, que es idempotente: `categorias`,
`transacciones`, `presupuestos`, `ajustes`, `proximos_gastos` y
`compras_deseadas`.

Dos que se confunden facil:

- **proximos_gastos**: obligaciones con fecha (IBI, seguro). Se ordenan por fecha.
- **compras_deseadas**: caprichos sin fecha fija. Se ordenan por prioridad y el
  dashboard calcula cuando podras permitirtelos con tu ritmo real de ahorro.

## Categorias

Jerarquia de dos niveles via `categorias.padre_id` (NULL = categoria madre).
El presupuesto de una madre **agrega el gasto de sus subcategorias**, y en la
tarjeta de presupuestos las madres salen plegadas: se pulsa el nombre para ver
el desglose.

Ids reales en uso hoy:

| Madre | Subcategorias |
|---|---|
| Comida (1) | Comida con Silvia (13), Restaurantes (12), Comida del trabajo (21), Supermercado (2) |
| Coche (3) | Gasolina (22), Taller (17), Mantenimiento (23) |
| Salud (6) | Peluqueria (18) |
| Otros ingresos (11) | Dinero padre (19), Ingreso extra (20), Bizum (25) |

Sueltas: Vivienda (4), Ocio (5), Suscripciones (7), Compras (8), Deporte (15),
Educacion (16), Otros gastos (9), Nomina (10).

Todo lo que es comer cuelga de **Comida**, Supermercado incluido.

## El bot (n8n)

`scripts/build_wf.js` es la fuente de verdad del workflow: genera
`n8n_finanzas_workflow.json` listo para importar.

```
node scripts/build_wf.js     # escribe el json y lo valida
```

El prompt del sistema lleva dentro **la lista de categorias con sus ids**.
Si cambian las categorias hay que editar ese prompt en `build_wf.js`,
regenerar el json y **reimportar el workflow en n8n** (n8n corre con su propia
copia; tocar el json del repo no basta).

Antes de importar hay que rellenar los placeholders del json:
`PEGAR_TOKEN_DEL_BOT` (dos veces), `PEGAR_GROQ_API_KEY` y
`PEGAR_SERVICE_ROLE_KEY` (dos veces, en "Guardar en Supabase").

Que sabe hacer:

- **Varios movimientos a la vez**: "2€ cafe y 15 de gasolina", o una lista con
  saltos de linea. Los mensajes pendientes se juntan en lotes de 10 y van a la
  IA en una sola llamada (Groq gratis da 8000 tokens/min).
- **Cola acumulada**: si n8n estaba apagado, al arrancar lee lo que mandaste
  mientras tanto y cada movimiento lleva **la fecha en que enviaste el mensaje**.
  Telegram solo guarda los mensajes **24 horas**: lo mas antiguo se pierde.
- **Fechas pasadas**: "2€ en comida del 25 de agosto", "ayer", "el sabado". Se
  cuentan desde el dia de envio, sin año es la mas reciente no futura, y se
  guarda ese dia a mediodia (hora de Madrid).

Si la IA o Supabase fallan, el offset de Telegram no avanza y el lote se
reintenta en la siguiente vuelta; tras 6 fallos seguidos (~1 min) se descarta y
el bot pide reenviarlo. Cada fila lleva `ref_externa = tg:<chat>:<mensaje>:<n>`
(indice unico), asi que reprocesar un lote no duplica nada ni repite el ✅.

## Desplegar

Es estatico: cualquier hosting de estaticos sirve. Se despliega en Netlify
conectando este repo (deploy automatico en cada push).

## Nota de seguridad

La publishable key de Supabase es publica por diseno y segura para un sitio
estatico: solo abre las puertas que la RLS por usuario deja abiertas. Nunca
subir la *secret key* aqui, ni el token del bot de Telegram.

El bot de n8n escribe con la key legacy `service_role`, que salta la RLS: esa
key vive solo en la config de n8n, nunca en este repo (el json versionado
conserva placeholders).
