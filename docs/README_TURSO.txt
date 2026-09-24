PERMISOB - CLOUDFLARE PAGES + TURSO
===================================

Este paquete usa _worker.js (Cloudflare Pages Advanced Mode).
No necesitas crear un Worker separado.

1. En Cloudflare Pages > proyecto permisob > Settings > Variables and Secrets:
   - TURSO_DATABASE_URL = libsql://...turso.io
   - TURSO_AUTH_TOKEN = tu token (Secret)

2. Vuelve a desplegar TODO el contenido de esta carpeta, incluido _worker.js.

3. Comprueba:
   https://permisob.pages.dev/api/health
   Debe devolver JSON con: {"ok":true,...}

4. Comprueba Turso:
   https://permisob.pages.dev/api/db-health
   Debe devolver JSON con: {"ok":true,"database":"connected",...}

El worker crea automáticamente la tabla user_state si no existe.
La web guarda primero en localStorage y después envía el estado a /api/state.
Si Turso falla, el progreso local se conserva.

IMPORTANTE:
- No metas TURSO_AUTH_TOKEN en config.js.
- config.js solo apunta a la API del mismo dominio.
- userKey está configurado como permisob_personal_raul. El backend recibe únicamente el SHA-256.
