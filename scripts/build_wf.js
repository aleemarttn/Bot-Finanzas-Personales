const fs = require('fs');

const SUPA_URL = "https://jtkhvvkfgqotvhljtybp.supabase.co";
const SUPA_KEY = "sb_publishable_BVJ9sAnDj4tB25sVsZss8A_26cm57wL";
const CHAT_ID = 950662101;

const systemPrompt = `Eres un asistente de finanzas personales. Conviertes un mensaje corto en español sobre un gasto o un ingreso en un objeto JSON.

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
- "tipo" = "gasto" salvo que claramente sea un ingreso (nómina, me han pagado, cobro...), entonces "ingreso".
- Elige la subcategoría más específica si encaja: "cena con Silvia" -> 13; "comí en un restaurante" -> 12; "el menú de la oficina" -> 21; "la compra del súper" -> 2; "eché gasolina" -> 22.
- "importe" en euros, número (acepta coma o punto decimal).
- "descripcion" = resumen corto del mensaje.
- Si no encaja en nada, usa 9 (gasto) u 11 (ingreso).

Devuelve SOLO el JSON, sin texto extra:
{"importe": number, "tipo": "gasto"|"ingreso", "categoria_id": number, "descripcion": string}`;

const code_offset = "const data = $getWorkflowStaticData('global');\nreturn [{ json: { offset: data.tg_offset || 0 } }];";

const code_process =
"const data = $getWorkflowStaticData('global');\n" +
"const updates = $input.first().json.result || [];\n" +
"const out = [];\n" +
"let maxId = data.tg_offset || 0;\n\n" +
"const systemPrompt = " + JSON.stringify(systemPrompt) + ";\n\n" +
"for (const u of updates) {\n" +
"  if (u.update_id >= maxId) maxId = u.update_id + 1;\n" +
"  const msg = u.message;\n" +
"  if (msg && msg.text) {\n" +
"    if (msg.chat.id !== " + CHAT_ID + ") continue; // solo tu chat\n" +
"    out.push({ json: { texto: msg.text, chat_id: msg.chat.id, systemPrompt } });\n" +
"  }\n" +
"}\n" +
"data.tg_offset = maxId;\n" +
"return out;";

const code_build =
"const ai = JSON.parse($json.choices[0].message.content);\n" +
"const chat_id = $('Procesar updates').item.json.chat_id;\n" +
"return [{ json: {\n" +
"  importe: ai.importe,\n" +
"  tipo: ai.tipo,\n" +
"  categoria_id: ai.categoria_id,\n" +
"  descripcion: ai.descripcion || null,\n" +
"  chat_id\n" +
"}}];";

const groq_body =
'={\n' +
'  "model": "llama-3.3-70b-versatile",\n' +
'  "response_format": { "type": "json_object" },\n' +
'  "messages": [\n' +
'    { "role": "system", "content": {{ JSON.stringify($json.systemPrompt) }} },\n' +
'    { "role": "user", "content": {{ JSON.stringify($json.texto) }} }\n' +
'  ]\n' +
'}';

const supa_body =
'={\n' +
'  "importe": {{ $json.importe }},\n' +
'  "tipo": {{ JSON.stringify($json.tipo) }},\n' +
'  "categoria_id": {{ $json.categoria_id }},\n' +
'  "descripcion": {{ JSON.stringify($json.descripcion) }},\n' +
'  "origen": "telegram"\n' +
'}';

const tg_body =
'={\n' +
'  "chat_id": {{ $(\'Construir registro\').item.json.chat_id }},\n' +
'  "text": {{ JSON.stringify("✅ Apuntado: " + $(\'Construir registro\').item.json.importe + " € (cat " + $(\'Construir registro\').item.json.categoria_id + ")") }}\n' +
'}';

const nodes = [
 { parameters:{rule:{interval:[{field:"minutes",minutesInterval:1}]}},
   id:"n1", name:"Cada 1 min", type:"n8n-nodes-base.scheduleTrigger", typeVersion:1.2, position:[-100,300] },
 { parameters:{jsCode:code_offset},
   id:"n2", name:"Leer offset", type:"n8n-nodes-base.code", typeVersion:2, position:[120,300] },
 { parameters:{ method:"GET",
     url:"https://api.telegram.org/botPEGAR_TOKEN_DEL_BOT/getUpdates",
     sendQuery:true,
     queryParameters:{parameters:[
        {name:"offset",value:"={{ $json.offset }}"},
        {name:"timeout",value:"0"} ]},
     options:{} },
   id:"n3", name:"getUpdates", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[340,300] },
 { parameters:{jsCode:code_process},
   id:"n4", name:"Procesar updates", type:"n8n-nodes-base.code", typeVersion:2, position:[560,300] },
 { parameters:{ method:"POST",
     url:"https://api.groq.com/openai/v1/chat/completions",
     sendHeaders:true,
     headerParameters:{parameters:[ {name:"Authorization",value:"Bearer PEGAR_GROQ_API_KEY"} ]},
     sendBody:true, specifyBody:"json", jsonBody:groq_body, options:{} },
   id:"n5", name:"IA (Groq) parsear", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[780,300] },
 { parameters:{jsCode:code_build},
   id:"n6", name:"Construir registro", type:"n8n-nodes-base.code", typeVersion:2, position:[1000,300] },
 { parameters:{ method:"POST",
     url:SUPA_URL+"/rest/v1/transacciones",
     sendHeaders:true,
     headerParameters:{parameters:[
        {name:"apikey",value:SUPA_KEY},
        {name:"Authorization",value:"Bearer "+SUPA_KEY},
        {name:"Prefer",value:"return=minimal"} ]},
     sendBody:true, specifyBody:"json", jsonBody:supa_body, options:{} },
   id:"n7", name:"Guardar en Supabase", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[1220,300] },
 { parameters:{ method:"POST",
     url:"https://api.telegram.org/botPEGAR_TOKEN_DEL_BOT/sendMessage",
     sendBody:true, specifyBody:"json", jsonBody:tg_body, options:{} },
   id:"n8", name:"Confirmar en Telegram", type:"n8n-nodes-base.httpRequest", typeVersion:4.2, position:[1440,300] }
];

const chain = ["Cada 1 min","Leer offset","getUpdates","Procesar updates","IA (Groq) parsear","Construir registro","Guardar en Supabase","Confirmar en Telegram"];
const connections = {};
for (let i=0;i<chain.length-1;i++){
  connections[chain[i]] = { main: [[{ node: chain[i+1], type:"main", index:0 }]] };
}

const wf = { name:"Finanzas · Bot Telegram (Groq)", nodes, connections, settings:{executionOrder:"v1"} };

const out = "C:/Users/aleja/n8n_finanzas_workflow.json";
fs.writeFileSync(out, JSON.stringify(wf, null, 2), "utf-8");
JSON.parse(fs.readFileSync(out,"utf-8"));
console.log("Escrito y validado:", out, "| nodos:", wf.nodes.length);
