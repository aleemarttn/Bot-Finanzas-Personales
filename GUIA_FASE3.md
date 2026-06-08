# Fase 3 — Bot de Telegram + n8n (con IA)

Objetivo: mandas al bot un mensaje como *"cena con Silvia 32"* y n8n lo interpreta con IA y lo guarda en tu tabla `transacciones` de Supabase. El dashboard lo ve automáticamente.

Flujo: **Telegram → n8n (tu PC) → IA parsea → Supabase → confirmación en Telegram**

---

## Parte A · Crear el bot en Telegram (5 min)

1. En Telegram, busca **@BotFather** y ábrelo.
2. Envía `/newbot`.
3. Te pide un **nombre** (libre, ej. *Mis Finanzas*) y un **username** que debe acabar en `bot` (ej. `misfinanzas_ale_bot`).
4. BotFather te da un **token** tipo `8123456789:AAH...`. **Guárdalo**, es la llave del bot.
5. Escríbele algo a tu bot desde tu Telegram (para que exista el chat).
6. (Opcional, recomendado) consigue tu **chat_id** para que solo tú puedas usarlo: abre en el navegador
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
   y busca `"chat":{"id": 123456789`. Ese número es tu chat_id.

---

## Parte B · Cómo recibe n8n los mensajes (importante)

En n8n hay dos formas:

- **Webhook** (nodo *Telegram Trigger*): Telegram llama a n8n. Necesita URL pública con HTTPS. Ideal en el VPS (Dokploy te da el HTTPS), **no** en local sin túnel.
- **Polling** (lo que usamos ahora): un disparador programado pregunta a Telegram cada minuto con `getUpdates`. **No necesita URL pública ni túnel.** Perfecto para tu PC.

> Cuando pases al VPS podrás sustituir el bloque de polling por un único nodo *Telegram Trigger*. El resto del workflow no cambia.

---

## Parte C · El workflow en n8n (modo polling, sin túnel)

Crea un workflow nuevo con estos nodos en orden. Entre paréntesis, el tipo de nodo.

### 1) Schedule Trigger  *(Schedule Trigger)*
- Modo: cada **1 minuto** (o 30 s si lo quieres más ágil).

### 2) Leer offset  *(Code)*
Evita procesar dos veces el mismo mensaje. Pega:
```js
const data = $getWorkflowStaticData('global');
return [{ json: { offset: data.tg_offset || 0 } }];
```

### 3) getUpdates  *(HTTP Request)*
- Método: **GET**
- URL: `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
- Query params:
  - `offset` = `={{ $json.offset }}`
  - `timeout` = `0`

### 4) Procesar updates  *(Code)*
Extrae los mensajes nuevos y guarda el offset:
```js
const data = $getWorkflowStaticData('global');
const updates = $input.first().json.result || [];
const out = [];
let maxId = data.tg_offset || 0;
for (const u of updates) {
  if (u.update_id >= maxId) maxId = u.update_id + 1;
  const msg = u.message;
  if (msg && msg.text) {
    // (Opcional seguridad) descomenta para aceptar solo tu chat:
    // if (msg.chat.id !== 123456789) continue;
    out.push({ json: { texto: msg.text, chat_id: msg.chat.id } });
  }
}
data.tg_offset = maxId;
return out;   // un item por mensaje; vacío si no hay nada
```

### 5) IA · parsear  *(HTTP Request)*
Llama a la IA para convertir el texto en JSON.
- Método: **POST**
- URL: `https://api.openai.com/v1/chat/completions`
- Headers:
  - `Authorization` = `Bearer <TU_OPENAI_API_KEY>`
  - `Content-Type` = `application/json`
- Body (JSON):
```json
{
  "model": "gpt-4o-mini",
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "PEGA_AQUI_EL_PROMPT_DE_LA_PARTE_D" },
    { "role": "user", "content": "={{ $json.texto }}" }
  ]
}
```
> ¿No quieres OpenAI? Puedes apuntar esta misma llamada a cualquier API compatible (incluido un modelo local). Solo cambia URL y cabecera.

### 6) Construir registro  *(Code)*
Convierte la respuesta de la IA en los campos de la tabla:
```js
const ai = JSON.parse($json.choices[0].message.content);
const chat_id = $('Procesar updates').item.json.chat_id;
return [{ json: {
  importe: ai.importe,
  tipo: ai.tipo,
  categoria_id: ai.categoria_id,
  descripcion: ai.descripcion || null,
  chat_id
}}];
```

### 7) Guardar en Supabase  *(HTTP Request)*
- Método: **POST**
- URL: `<TU_SUPABASE_URL>/rest/v1/transacciones`
- Headers:
  - `apikey` = `<TU_ANON_KEY>`
  - `Authorization` = `Bearer <TU_ANON_KEY>`
  - `Content-Type` = `application/json`
  - `Prefer` = `return=minimal`
- Body (JSON):
```json
{
  "importe": "={{ $json.importe }}",
  "tipo": "={{ $json.tipo }}",
  "categoria_id": "={{ $json.categoria_id }}",
  "descripcion": "={{ $json.descripcion }}",
  "origen": "telegram"
}
```
> No mandamos `fecha`: la base de datos pone la fecha y hora actuales automáticamente.

### 8) Confirmar en Telegram  *(HTTP Request)*
- Método: **POST**
- URL: `https://api.telegram.org/bot<TU_TOKEN>/sendMessage`
- Body (JSON):
```json
{
  "chat_id": "={{ $('Construir registro').item.json.chat_id }}",
  "text": "=✅ Apuntado: {{ $('Construir registro').item.json.importe }} € (categoría {{ $('Construir registro').item.json.categoria_id }})"
}
```

Conecta los nodos en cadena: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

## Parte D · El prompt de la IA (cópialo en el nodo 5)

```
Eres un asistente de finanzas personales. Conviertes un mensaje corto en español sobre un gasto o un ingreso en un objeto JSON.

Categorías válidas (devuelve el "categoria_id" EXACTO):
GASTOS:
- 1  = Comida (genérico, si no sabes la subcategoría)
- 12 = Restaurante (subcategoría de Comida)
- 13 = Comida con Silvia (subcategoría de Comida)
- 14 = Comida en casa (subcategoría de Comida)
- 2  = Supermercado
- 3  = Transporte
- 4  = Vivienda
- 5  = Ocio
- 6  = Salud
- 7  = Suscripciones
- 8  = Compras
- 9  = Otros gastos
INGRESOS:
- 10 = Nómina
- 11 = Otros ingresos

Reglas:
- "tipo" = "gasto" salvo que claramente sea un ingreso (nómina, me han pagado, cobro...), entonces "ingreso".
- Elige la subcategoría más específica si encaja: "cena con Silvia" -> 13; "comí en un restaurante" -> 12; "compra para cocinar en casa" -> 14; "la compra del súper" -> 2.
- "importe" en euros, número (acepta coma o punto decimal).
- "descripcion" = resumen corto del mensaje.
- Si no encaja en nada, usa 9 (gasto) u 11 (ingreso).

Devuelve SOLO el JSON, sin texto extra:
{"importe": number, "tipo": "gasto"|"ingreso", "categoria_id": number, "descripcion": string}
```

> **Importante:** estos ids corresponden a las categorías que crea el SQL de la Fase 1. Si añades o cambias categorías (con el botón del dashboard), mira los ids reales en la tabla `categorias` de Supabase y actualiza esta lista del prompt.

---

## Parte E · Probar

1. Pon tus tokens/keys en los nodos (Telegram, OpenAI, Supabase).
2. **Activa** el workflow (interruptor arriba a la derecha) o pulsa *Execute workflow* para probar una vez.
3. Manda a tu bot: `cena con Silvia 32`.
4. En menos de 1 minuto debe responder *"✅ Apuntado…"* y aparecer la fila en el dashboard.

Pruebas útiles: `café 2,40`, `gasolina 45`, `me han pagado la nómina 1850`, `compra del super 63.10`.

---

## Parte F · Seguridad

- Descomenta el filtro por `chat_id` del nodo 4 para que solo tu Telegram pueda escribir.
- La `anon key` de Supabase es pública por diseño; las tablas están protegidas con RLS (políticas abiertas para uso personal). Si más adelante quieres login, se afinan ahí.

---

## Parte G · Cuando pases al VPS (Hostinger + Dokploy)

1. Exporta este workflow (menú ··· → *Download*) e impórtalo en el n8n del VPS.
2. Allí puedes sustituir los nodos 1–4 por un único **Telegram Trigger** (webhook), ya que Dokploy te da HTTPS.
3. Mismas credenciales de Telegram, OpenAI y Supabase. El resto no cambia.
