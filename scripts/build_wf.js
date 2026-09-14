const fs = require('fs');
const path = require('path');

const SUPA_URL = "https://jtkhvvkfgqotvhljtybp.supabase.co";
const SUPA_KEY = "PEGAR_SERVICE_ROLE_KEY";   // legacy service_role (eyJ...): salta la RLS, NUNCA en el repo
const CHAT_ID = 950662101;
const USER_ID = "0d24ebb9-7050-4d4c-9a1d-0f7c15523ad8";   // dueño de las filas (la RLS es por usuario)
const LOTE = 10;        // mensajes por ejecución = por llamada a la IA (Groq gratis: 8000 tokens/min)
const MAX_FALLOS = 6;   // vueltas seguidas (cada 10 s) reintentando un lote antes de darlo por perdido

const CATS = {
  1:'Comida', 2:'Supermercado', 3:'Coche', 4:'Vivienda', 5:'Ocio', 6:'Salud',
  7:'Suscripciones', 8:'Compras', 9:'Otros gastos', 10:'Nómina', 11:'Otros ingresos',
  12:'Restaurantes', 13:'Comida con Silvia', 15:'Deporte', 16:'Educación', 17:'Taller',
  18:'Peluquería', 19:'Dinero padre', 20:'Ingreso extra', 21:'Comida del trabajo',
  22:'Gasolina', 23:'Mantenimiento', 25:'Bizum'
};
const INGRESOS = [10, 11, 19, 20, 25];

const systemPrompt = `Eres un asistente de finanzas personales. Recibes uno o varios mensajes cortos en español, numerados [1], [2]..., cada uno con el día en que se envió. Extraes TODOS los gastos e ingresos que contengan.

Categorías válidas (devuelve el "categoria_id" EXACTO):
GASTOS:
- 1  = Comida (genérico, si no sabes la subcategoría)
- 13 = Comida con Silvia (subcategoría de Comida)
- 12 = Restaurantes (subcategoría de Comida)
- 21 = Comida del trabajo (subcategoría de Comida)
- 2  = Supermercado (subcategoría de Comida)
- 3  = Coche
- 22 = Gasolina (subcategoría de Coche)
- 17 = Taller (subcategoría de Coche)
- 23 = Mantenimiento (subcategoría de Coche)
- 4  = Vivienda
- 5  = Ocio
- 6  = Salud
- 18 = Peluquería (subcategoría de Salud)
- 7  = Suscripciones
- 8  = Compras
- 15 = Deporte
- 16 = Educación
- 9  = Otros gastos
INGRESOS:
- 10 = Nómina
- 11 = Otros ingresos
- 19 = Dinero padre (subcategoría de Otros ingresos)
- 20 = Ingreso extra (subcategoría de Otros ingresos)
- 25 = Bizum (subcategoría de Otros ingresos)

Reglas:
- Un mensaje puede traer VARIOS movimientos (separados por comas, "y", saltos de línea...): crea uno por cada importe. "n" = número del mensaje del que sale.
- Si un mensaje no contiene ningún gasto ni ingreso con importe, no generes nada para él.
- "tipo" = "gasto" salvo que claramente sea un ingreso (nómina, me han pagado, cobro...), entonces "ingreso".
- Elige la subcategoría más específica si encaja: "cena con Silvia" -> 13; "comí en un restaurante" -> 12; "el menú de la oficina" -> 21; "la compra del súper" -> 2; "eché gasolina" -> 22.
- "importe" en euros, número (acepta coma o punto decimal).
- "descripcion" = resumen corto de ESE movimiento.
- Si no encaja en nada, usa 9 (gasto) u 11 (ingreso).
- "fecha" ("YYYY-MM-DD"): SOLO si el mensaje dice cuándo fue ("ayer", "el sábado", "del 25 de agosto", "el 3/9"). Calcúlala respecto al día de envío de ESE mensaje. Sin año, usa el más reciente que no sea posterior al día de envío. Una fecha dicha una vez vale para todos los movimientos de ese mensaje. Si no se dice fecha, "fecha": null.

Ejemplo. Entrada:
[1] (enviado el lunes 2026-09-14) 2€ café y 15 de gasolina
[2] (enviado el lunes 2026-09-14) 2€ en comida del 25 de agosto
Salida:
{"movimientos":[{"n":1,"importe":2,"tipo":"gasto","categoria_id":1,"descripcion":"Café","fecha":null},{"n":1,"importe":15,"tipo":"gasto","categoria_id":22,"descripcion":"Gasolina","fecha":null},{"n":2,"importe":2,"tipo":"gasto","categoria_id":1,"descripcion":"Comida","fecha":"2026-08-25"}]}

Devuelve SOLO el JSON, sin texto extra:
{"movimientos":[{"n": number, "importe": number, "tipo": "gasto"|"ingreso", "categoria_id": number, "descripcion": string, "fecha": "YYYY-MM-DD"|null}]}`;

const code_offset = "const data = $getWorkflowStaticData('global');\nreturn [{ json: { offset: data.tg_offset || 0 } }];";

// Junta los mensajes pendientes (varios seguidos, o la cola acumulada con n8n apagado) en UN item:
// una llamada a la IA por lote. NO avanza el offset: eso lo hace "Preparar respuesta" cuando el lote
// se ha guardado, así un fallo deja los mensajes en Telegram y se reintentan en la siguiente vuelta.
const code_process = `const data = $getWorkflowStaticData('global');
const updates = $input.first().json.result || [];
let siguiente_offset = data.tg_offset || 0;

const systemPrompt = ${JSON.stringify(systemPrompt)};
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const diaMadrid = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const mensajes = [];
for (const u of updates) {
  if (u.update_id >= siguiente_offset) siguiente_offset = u.update_id + 1;
  const msg = u.message;
  if (!msg || !msg.text) continue;
  if (msg.chat.id !== ${CHAT_ID}) continue; // solo tu chat
  if (msg.text.startsWith('/')) continue;    // /start y demás comandos
  const enviado = new Date(msg.date * 1000); // cuándo lo mandaste, no cuándo lo lee n8n
  const dia = diaMadrid(enviado);
  mensajes.push({
    n: mensajes.length + 1,
    message_id: msg.message_id,
    texto: msg.text,
    enviado_iso: enviado.toISOString(),
    dia_envio: dia,
    dia_semana: DIAS[new Date(dia + 'T12:00:00Z').getUTCDay()]
  });
}
if (!mensajes.length) {            // nada que apuntar (o solo comandos / otros chats): se descartan ya
  data.tg_offset = siguiente_offset;
  return [];
}

const entrada = mensajes.map(m => '[' + m.n + '] (enviado el ' + m.dia_semana + ' ' + m.dia_envio + ') ' + m.texto).join('\\n');
return [{ json: { chat_id: ${CHAT_ID}, mensajes, entrada, systemPrompt, siguiente_offset } }];`;

const code_build = `const CATS = ${JSON.stringify(CATS)};
const INGRESOS = ${JSON.stringify(INGRESOS)};
const USER_ID = ${JSON.stringify(USER_ID)};
const TZ = 'Europe/Madrid';

const { chat_id, mensajes, siguiente_offset } = $('Procesar updates').first().json;
const diaMadrid = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const offsetMadrid = ymd => new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
  .formatToParts(new Date(ymd + 'T12:00:00Z')).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+00:00';
const esDiaReal = ymd => /^\\d{4}-\\d{2}-\\d{2}$/.test(ymd) && new Date(ymd + 'T12:00:00Z').toISOString().slice(0, 10) === ymd;
const eur = x => x.toLocaleString('es-ES', { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
const hoy = diaMadrid(new Date());
const corto = ymd => ymd.slice(8, 10) + '/' + ymd.slice(5, 7) + (ymd.slice(0, 4) === hoy.slice(0, 4) ? '' : '/' + ymd.slice(0, 4));

let movs = null;
try {
  const ai = JSON.parse($input.first().json.choices[0].message.content);
  movs = Array.isArray(ai.movimientos) ? ai.movimientos : null;
} catch (e) {}
if (!movs) return [{ json: { chat_id, mensajes, siguiente_offset, ia_fallo: true, filas: [], lineas: {}, sin_entender: [] } }];

const filas = [], lineas = {}, usados = {};
for (const mov of movs) {
  const m = mensajes.find(x => x.n === Number(mov.n)) || (mensajes.length === 1 ? mensajes[0] : null);
  if (!m) continue;

  let importe = typeof mov.importe === 'string' ? parseFloat(mov.importe.replace(',', '.')) : Number(mov.importe);
  if (!(importe > 0)) continue;
  importe = Math.round(importe * 100) / 100;

  let cat = Number(mov.categoria_id);
  if (!CATS[cat]) cat = mov.tipo === 'ingreso' ? 11 : 9;
  const tipo = INGRESOS.includes(cat) ? 'ingreso' : 'gasto';   // la categoría manda

  // Sin fecha dicha: el momento en que enviaste el mensaje. Con fecha: ese día a mediodía (hora de Madrid).
  let fecha = m.enviado_iso, dia = m.dia_envio;
  let d = typeof mov.fecha === 'string' ? mov.fecha : '';
  for (let i = 0; i < 2 && esDiaReal(d) && d > m.dia_envio; i++) d = (Number(d.slice(0, 4)) - 1) + d.slice(4);   // "25 de agosto" nunca es futuro
  if (esDiaReal(d) && d < m.dia_envio) {
    dia = d;
    fecha = d + 'T12:00:00' + offsetMadrid(d);
  }

  usados[m.n] = (usados[m.n] || 0) + 1;
  const ref_externa = 'tg:' + chat_id + ':' + m.message_id + ':' + usados[m.n];   // evita duplicados si un lote se procesa dos veces
  filas.push({
    fecha, importe, tipo, categoria_id: cat,
    descripcion: String(mov.descripcion || '').slice(0, 200) || null,
    origen: 'telegram',
    user_id: USER_ID,
    ref_externa
  });
  lineas[ref_externa] = (tipo === 'ingreso' ? '+' : '') + eur(importe) + ' en ' + CATS[cat] + (dia !== hoy ? ' · ' + corto(dia) : '');
}

const sin_entender = mensajes.filter(m => !usados[m.n]).map(m => m.texto);
return [{ json: { chat_id, mensajes, siguiente_offset, ia_fallo: false, filas, lineas, sin_entender } }];`;

// Decide qué contestar y si el lote queda hecho (avanza el offset) o se reintenta en la siguiente vuelta.
const code_reply = `const MAX_FALLOS = ${MAX_FALLOS};
const b = $('Construir registros').first().json;
const data = $getWorkflowStaticData('global');
const cita = t => '«' + (t.length > 80 ? t.slice(0, 80) + '…' : t) + '»';

const devueltas = $input.all().map(i => i.json);
const errSupa = devueltas.find(j => j.error);
if (b.ia_fallo || errSupa) {
  data.fallos = (data.fallos || 0) + 1;
  if (data.fallos < MAX_FALLOS) return [];   // los mensajes siguen en Telegram: se reintenta en 10 s
  data.fallos = 0;
  data.tg_offset = b.siguiente_offset;       // lote imposible: se descarta para no atascar la cola
  const n = b.mensajes.length;
  const motivo = b.ia_fallo ? 'la IA no responde' : 'Supabase da error (' + (errSupa.error.message || errSupa.error) + ')';
  return [{ json: { chat_id: b.chat_id, texto: '⚠️ No he podido apuntar ' + (n === 1 ? 'tu mensaje' : 'estos ' + n + ' mensajes') +
    ': ' + motivo + '. Reenvía:\\n' + b.mensajes.map(m => '• ' + cita(m.texto)).join('\\n') } }];
}
data.fallos = 0;
data.tg_offset = b.siguiente_offset;

// Supabase devuelve solo las filas insertadas de verdad: si el lote ya estaba guardado no se repite el ✅
const nuevas = new Set(devueltas.flatMap(j => Array.isArray(j.data) ? j.data : [j]).map(f => f && f.ref_externa).filter(Boolean));
if (b.filas.length && !nuevas.size) return [];
const lineas = Object.keys(b.lineas).filter(r => nuevas.has(r)).map(r => b.lineas[r]);

const partes = [];
if (lineas.length === 1) partes.push('✅ Apuntado: ' + lineas[0]);
else if (lineas.length > 1) partes.push('✅ Apuntados ' + lineas.length + ' movimientos:\\n' + lineas.map(l => '• ' + l).join('\\n'));
if (b.sin_entender.length) partes.push('🤷 No he entendido:\\n' + b.sin_entender.map(t => '• ' + cita(t)).join('\\n'));
if (!partes.length) return [];
return [{ json: { chat_id: b.chat_id, texto: partes.join('\\n\\n').slice(0, 4000) } }];`;

const groq_body =
'={\n' +
'  "model": "openai/gpt-oss-120b",\n' +
'  "response_format": { "type": "json_object" },\n' +
'  "messages": [\n' +
'    { "role": "system", "content": {{ JSON.stringify($json.systemPrompt) }} },\n' +
'    { "role": "user", "content": {{ JSON.stringify($json.entrada) }} }\n' +
'  ]\n' +
'}';

// Un solo POST con todas las filas del lote; con [] no inserta nada.
const supa_body = '={{ JSON.stringify($json.filas) }}';

const tg_body =
'={\n' +
'  "chat_id": {{ $json.chat_id }},\n' +
'  "text": {{ JSON.stringify($json.texto) }}\n' +
'}';

const nodes = [
 { parameters:{rule:{interval:[{field:"seconds",secondsInterval:10}]}},
   id:"n1", name:"Cada 10 s", type:"n8n-nodes-base.scheduleTrigger", typeVersion:1.2, position:[-100,300] },
 { parameters:{jsCode:code_offset},
   id:"n2", name:"Leer offset", type:"n8n-nodes-base.code", typeVersion:2, position:[120,300] },
 { parameters:{ method:"GET",
     url:"https://api.telegram.org/botPEGAR_TOKEN_DEL_BOT/getUpdates",
     sendQuery:true,
     queryParameters:{parameters:[
        {name:"offset",value:"={{ $json.offset }}"},
        {name:"limit",value:String(LOTE)},
        {name:"timeout",value:"0"} ]},
     options:{} },
   id:"n3", name:"getUpdates", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[340,300] },
 { parameters:{jsCode:code_process},
   id:"n4", name:"Procesar updates", type:"n8n-nodes-base.code", typeVersion:2, position:[560,300] },
 { parameters:{ method:"POST",
     url:"https://api.groq.com/openai/v1/chat/completions",
     sendHeaders:true,
     headerParameters:{parameters:[ {name:"Authorization",value:"Bearer PEGAR_GROQ_API_KEY"} ]},
     sendBody:true, specifyBody:"json", jsonBody:groq_body, options:{ timeout:30000 } },
   id:"n5", name:"IA (Groq) parsear", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[780,300],
   onError:"continueRegularOutput" },
 { parameters:{jsCode:code_build},
   id:"n6", name:"Construir registros", type:"n8n-nodes-base.code", typeVersion:2, position:[1000,300] },
 { parameters:{ method:"POST",
     url:SUPA_URL+"/rest/v1/transacciones",
     sendQuery:true,
     queryParameters:{parameters:[
        {name:"on_conflict",value:"ref_externa"},
        {name:"select",value:"ref_externa"} ]},
     sendHeaders:true,
     headerParameters:{parameters:[
        {name:"apikey",value:SUPA_KEY},
        {name:"Authorization",value:"Bearer "+SUPA_KEY},
        {name:"Prefer",value:"resolution=ignore-duplicates,return=representation"} ]},
     sendBody:true, specifyBody:"json", jsonBody:supa_body, options:{} },
   id:"n7", name:"Guardar en Supabase", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[1220,300],
   alwaysOutputData:true, onError:"continueRegularOutput" },
 { parameters:{jsCode:code_reply, mode:"runOnceForAllItems"},
   id:"n8", name:"Preparar respuesta", type:"n8n-nodes-base.code", typeVersion:2, position:[1440,300] },
 { parameters:{ method:"POST",
     url:"https://api.telegram.org/botPEGAR_TOKEN_DEL_BOT/sendMessage",
     sendBody:true, specifyBody:"json", jsonBody:tg_body, options:{} },
   id:"n9", name:"Confirmar en Telegram", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[1660,300] }
];

const chain = ["Cada 10 s","Leer offset","getUpdates","Procesar updates","IA (Groq) parsear","Construir registros","Guardar en Supabase","Preparar respuesta","Confirmar en Telegram"];
const connections = {};
for (let i=0;i<chain.length-1;i++){
  connections[chain[i]] = { main: [[{ node: chain[i+1], type:"main", index:0 }]] };
}

const wf = { name:"Finanzas · Bot Telegram (Groq)", nodes, connections, settings:{executionOrder:"v1"} };

const out = path.join(__dirname, "..", "n8n_finanzas_workflow.json");
fs.writeFileSync(out, JSON.stringify(wf, null, 2), "utf-8");
JSON.parse(fs.readFileSync(out,"utf-8"));
console.log("Escrito y validado:", out, "| nodos:", wf.nodes.length);
