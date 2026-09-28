# jev-chat-agent

Bot de Twitch que clasifica mensajes en tiempo real usando [Jev-Style-2B-Decision-v3](https://huggingface.co/chaoliangUNSW/Jev-Style-2B-Decision-v3) y loguea el resultado. **Modo observador**: no borra mensajes ni aplica acciones de moderación.

## Requisitos

- Node.js 18+
- Endpoint de Jev corriendo (ej. `http://mac-mini.local:8765/v1/systemone`)

## Instalación

```bash
cp .env.example .env
# Edita .env con tus credenciales
npm install
npm start
```

## Configuración

| Variable | Descripción |
|---|---|
| `TWITCH_CHANNEL` | Canal a monitorear |
| `TWITCH_USERNAME` | Nombre del bot |
| `TWITCH_TOKEN` | OAuth token del bot |
| `JEV_ENDPOINT` | URL del endpoint Jev |
| `JEV_THRESHOLD_*` | Umbrales de clasificación (0.0–1.0) |

## Categorías

- **insulto** — lenguaje ofensivo dirigido a otro usuario
- **spam** — contenido repetitivo o promoción no solicitada
- **toxicidad** — lenguaje dañino o acoso
- **links** — enlaces o URLs no permitidos

## Notas

- El bot usa una cola con concurrencia 1 para no saturar el endpoint Jev.
- Los mensajes de más de 500 caracteres se omiten.
- Reintentos automáticos con backoff si el endpoint falla.
