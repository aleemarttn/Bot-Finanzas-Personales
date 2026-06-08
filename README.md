# Mis Finanzas · Dashboard

Dashboard estatico (HTML/CSS/JS puro) para visualizar mis finanzas personales.
Los datos viven en Supabase y se registran a mano o via un bot de Telegram + n8n.

## Como funciona
- **index.html**: un unico archivo. Usa Chart.js y supabase-js por CDN. Sin build.
- **Datos**: Supabase (Postgres). El front lee/escribe con la publishable key (uso personal, RLS abierto).
- **Bot**: Telegram -> n8n (polling) -> IA (Groq) -> Supabase. El dashboard lo ve automaticamente.

## Desplegar
Es estatico: cualquier hosting de estaticos sirve. Aqui se despliega en Netlify
conectando este repo (deploy automatico en cada push).

## Nota de seguridad
La publishable key de Supabase es publica por diseno y segura para un sitio estatico.
Nunca subir la *secret key* aqui.
