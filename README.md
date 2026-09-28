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

### Obtener el token de Twitch

1. Ve a [twitchtokengenerator.com](https://twitchtokengenerator.com/)
2. Genera un token (necesitas permisos de lectura de chat)
3. Copia el **access token** y pégalo en `TWITCH_TOKEN` con el prefijo `oauth:`

Ejemplo: `TWITCH_TOKEN=oauth:abc123def456...`

> El bot solo lee y loguea, no necesita permisos de moderador.

| Variable | Descripción |
|---|---|
| `TWITCH_CHANNEL` | Canal a monitorear |
| `TWITCH_USERNAME` | Nombre del bot |
| `TWITCH_TOKEN` | OAuth token del bot |
| `JEV_ENDPOINT` | URL del endpoint Jev |
| `MODERATION_ENABLED` | `false` = solo log, `true` = borrar mensajes y timeout |
| `CHAT_MESSAGES_ENABLED` | `false` = no enviar mensajes al chat, `true` = avisar en el chat cuando se detecta algo |
| `JEV_CONTEXT_MESSAGES` | Número de mensajes recientes como contexto (default 3) |
| `JEV_EXCLUDED_USERS` | Lista separada por comas de nicks excluidos (ej. `mod1,bot2`) |
| `JEV_THRESHOLD_*` | Umbrales de clasificación (0.0–1.0). Usa `> 1` para desactivar una categoría |

## Categorías

- **insulto** — lenguaje ofensivo dirigido a otro usuario
- **spam** — contenido repetitivo o promoción no solicitada
- **toxicidad** — lenguaje dañino o acoso
- **links** — enlaces o URLs no permitidos
- **atencion** — preguntas/consultas dirigidas al streamer

## Notas

- El bot usa una cola con concurrencia 1 para no saturar el endpoint Jev.
- Los mensajes de más de 500 caracteres se omiten.
- Reintentos automáticos con backoff si el endpoint falla.
