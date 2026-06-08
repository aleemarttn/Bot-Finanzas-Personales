# Fase 1 — Puesta en marcha (Supabase + Dashboard)

Tienes 2 archivos:
- `supabase_schema.sql` — crea las tablas y categorías en tu base de datos.
- `index.html` — el dashboard. Funciona en **modo demo** nada más abrirlo; con tus claves pasa a datos reales.

---

## 1. Crear el proyecto en Supabase (5 min)

1. Entra en https://supabase.com y crea una cuenta (gratis).
2. **New project** → ponle nombre (ej. `finanzas`) y una contraseña de base de datos. Elige la región más cercana.
3. Espera ~2 min a que se aprovisione.

## 2. Crear las tablas

1. En el menú lateral: **SQL Editor** → **New query**.
2. Abre `supabase_schema.sql`, copia **todo** el contenido y pégalo.
3. Pulsa **Run**. Debe decir *Success*. Ya tienes tablas + categorías por defecto.

> Si lo ejecutas dos veces no pasa nada: está escrito para no duplicar.

## 3. Copiar tus claves

1. Menú lateral: **Project Settings** (el engranaje) → **API**.
2. Copia dos valores:
   - **Project URL** → algo como `https://abcd1234.supabase.co`
   - **anon public** (en *Project API keys*) → una cadena larga.

> La `anon key` es pública por diseño; es segura para un sitio estático. Las tablas están protegidas con RLS (políticas abiertas para uso personal; si luego quieres login, se afinan ahí).

## 4. Pegar las claves en el dashboard

Abre `index.html` y, arriba del `<script>`, sustituye:

```js
const SUPABASE_URL = "PEGA_AQUI_TU_URL";
const SUPABASE_ANON_KEY = "PEGA_AQUI_TU_ANON_KEY";
```

Por tus valores reales. Guarda y abre el archivo en el navegador: la insignia arriba a la derecha debe pasar de **“Modo demo”** (ámbar) a **“Conectado a Supabase”** (verde).

## 5. Subir a Netlify

Igual que tu tracker actual: arrastra la carpeta con `index.html` a Netlify (drop), o conéctalo a un repo de GitHub. Como es un único archivo estático, no hay build.

---

## Qué hace el dashboard

- **KPIs** del mes: ingresos, gastos, balance y tasa de ahorro.
- **Gráfico de categorías** (donut) del mes en curso.
- **Evolución** de ingresos vs gastos de los últimos 6 meses.
- **Tabla** de últimos movimientos con opción de borrar.
- **Formulario** para añadir gastos/ingresos a mano (escribe en Supabase al instante).
- **Recomendador** de reglas: balance negativo, gasto por encima de tu media, categoría dominante, suscripciones, etc. Sin IA ni coste.

## Cómo encaja con la Fase 3 (bot + n8n)

El bot de Telegram, vía tu n8n, insertará filas en **esta misma tabla `transacciones`** (con `origen = 'telegram'`). El dashboard las verá automáticamente sin tocar nada. Por eso montamos la base de datos primero.

### Cómo insertará n8n (para cuando llegues ahí)
En el nodo HTTP Request / Supabase de n8n harás un `POST` a:
```
{SUPABASE_URL}/rest/v1/transacciones
```
con cabeceras `apikey` y `Authorization: Bearer {anon key}`, y un body JSON como:
```json
{ "fecha":"2026-06-07", "importe":12.50, "tipo":"gasto", "categoria_id":1, "descripcion":"Café", "origen":"telegram" }
```
El paso de IA en n8n se encargará de convertir *"café 12,50"* en ese JSON (importe, categoría, descripción).

---

## Siguientes pasos sugeridos

1. Prueba el dashboard en modo demo para ver el resultado.
2. Conecta Supabase con tus claves.
3. Mete unos cuantos movimientos reales.
4. Cuando quieras, montamos la **Fase 3**: el workflow de n8n + bot de Telegram.
