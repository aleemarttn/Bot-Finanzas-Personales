# Proyecto: Dashboard de finanzas personales + bot de Telegram

Contexto para retomar el proyecto. Resume decisiones de arquitectura, modelo de datos, estado actual y lo que falta.

## Objetivo
App personal para registrar y analizar mis finanzas. Apunto gastos/ingresos en lenguaje natural por un bot de Telegram; n8n los interpreta con IA y los guarda; un dashboard web (estático, estilo el que ya tengo en Netlify) los visualiza y me da recomendaciones. Todo gratis al principio, con opción de mover n8n a un VPS de Hostinger (gestionado con Dokploy) más adelante.

## Arquitectura (por fases)
- **Ahora (sin VPS):** Telegram → n8n en mi PC (Docker Desktop, modo polling, sin túnel) → Supabase (Postgres, fuente de verdad) → Dashboard en Netlify (HTML/CSS/JS puro).
- **Después (VPS):** el mismo n8n se mueve a Hostinger con Dokploy (HTTPS automático), funcionando 24/7. Supabase y el dashboard NO cambian. Migrar = exportar/importar workflows y, si quiero, cambiar polling por Telegram Trigger (webhook).

Decisión clave: separar piezas para que migrar sea trivial. Los datos viven SIEMPRE en Supabase; n8n solo orquesta.

## Stack
- Frontend: **HTML/CSS/JS puro** (un único `index.html`), Chart.js y supabase-js por CDN. Sin framework, sin build. Se sube a Netlify.
- Datos: **Supabase** (Postgres). Acceso desde el front con la `anon key` (uso personal, RLS con políticas abiertas).
- Automatización: **n8n** (ya corriendo en mi PC con Docker Desktop).
- IA del bot: llamada HTTP a un modelo (elegí OpenAI gpt-4o-mini; se puede cambiar).

## Modelo de datos (Supabase) — ver `supabase_schema.sql`
- `categorias`: id, nombre (unique), tipo ('gasto'|'ingreso'), color, emoji, **padre_id** (NULL = principal; si tiene valor, es subcategoría), creado_en.
- `transacciones`: id, **fecha timestamptz** (día + hora, default now()), importe numeric, tipo, categoria_id (FK; puede ser categoría o subcategoría), descripcion, **origen** ('manual'|'telegram'), creado_en.
- `presupuestos`: límite mensual por categoría (opcional, para el recomendador).
- Categorías sembradas: Comida(1), Supermercado(2), Transporte(3), Vivienda(4), Ocio(5), Salud(6), Suscripciones(7), Compras(8), Otros gastos(9), Nómina(10), Otros ingresos(11). Subcategorías de Comida: Restaurante(12), Comida con Silvia(13), Comida en casa(14).

## Dashboard (`index.html`) — ya construido
- Funciona en **modo demo** (datos de ejemplo) si no hay claves; con `SUPABASE_URL` + `SUPABASE_ANON_KEY` pasa a datos reales (insignia verde).
- KPIs del mes: ingresos, gastos, balance, tasa de ahorro.
- **Donut de gasto por categoría** con drill-down: clic en el nombre de la leyenda (o en la porción) de una categoría con subcategorías muestra su desglose; botón "← Volver".
- **Gráfico de evolución** ingresos vs gastos con conmutador **6 meses / último año**.
- **Tabla** de últimos movimientos (fecha + hora, ruta "Categoría › Subcategoría", borrar).
- **Formulario** para añadir gasto/ingreso a mano: tipo, importe, categoría, subcategoría (si aplica), día, hora, descripción.
- Botón **"+ Nueva categoría"**: modal para crear categorías o subcategorías (nombre, emoji, color, padre) que se guardan en Supabase.
- **Recomendador** de reglas (sin IA): balance negativo, gasto vs media de meses previos, categoría dominante, desglose de subcategorías de Comida, suscripciones, aviso si hay pocos datos.

## Bot de Telegram + n8n (Fase 3) — ver `GUIA_FASE3.md` (aún por montar)
- Bot creado con @BotFather (token).
- Workflow n8n en **polling** (sin túnel, corre en local): Schedule Trigger → leer offset (static data) → getUpdates → procesar mensajes → llamada IA (devuelve JSON {importe, tipo, categoria_id, descripcion}) → insertar en Supabase (POST a /rest/v1/transacciones, sin fecha para que la ponga la BD) → confirmar en Telegram.
- El prompt de la IA incluye la lista de categorías con sus ids; hay que actualizarlo si cambian las categorías.
- Seguridad: filtro opcional por chat_id.

## Estado actual
- [x] Esquema SQL listo (`supabase_schema.sql`).
- [x] Dashboard completo (`index.html`).
- [x] Guía Fase 1 (`GUIA_FASE1.md`) y Fase 3 (`GUIA_FASE3.md`).
- [x] Proyecto de Supabase creado (por mí).
- [ ] Ejecutar el SQL en Supabase.
- [ ] Pegar URL + anon key en `index.html` y verificar (insignia verde).
- [ ] Subir dashboard a Netlify.
- [ ] Montar y probar el workflow de n8n con el bot.

## Notas / decisiones
- Sin Google Sheets. La única referencia a Google en el HTML es Google Fonts (tipografía Inter), no datos; se puede quitar para no depender de Google.
- Mantener `index.html` como archivo único (sin build) por simplicidad y para seguir desplegando en Netlify igual que el tracker actual.

## Lo que necesito ayuda para hacer ahora
(rellena según toque, p.ej.: "conectar el dashboard a Supabase y depurar", "montar el workflow de n8n", "añadir presupuestos por categoría al recomendador", etc.)
