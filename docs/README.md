# PermisoB · web completa

Paquete estático listo para publicar.

## Contenido
- 2.640 preguntas AEOL de los 88 simulacros del permiso B.
- 30 preguntas por simulacro, conservando simulacro y posición original.
- Enunciado, opciones A/B/C/D, solución y explicación.
- 2.616 imágenes recuperadas del banco original.
- 24 registros del origen no contenían una imagen Base64 utilizable; esas preguntas funcionan sin foto.
- Modo por temas, microtests de 5, simulacros, falladas, entrenador, XP, racha y progreso.

## Subir a la web
Sube **todo el contenido de esta carpeta manteniendo la estructura**. El `index.html` debe quedar en la raíz pública del sitio.

No abras `index.html` con `file://` para probarlo: los navegadores bloquean `fetch()` de JSON local. Prueba desde un servidor HTTP/HTTPS.

Ejemplo local:

```bash
python3 -m http.server 8000
```

Y abre `http://localhost:8000`.

## Estructura
```
index.html
styles.css
app.js
config.js
data/
  questions.json
  index.json
  topics.json
images/
  ...
```

## Turso / Worker
La web funciona sin servidor para estudiar; el progreso se guarda en `localStorage`.
Si quieres recuperar el progreso remoto entre dispositivos, configura `apiBase` y `userKey` en `config.js` con el Worker que ya uses.
