# AEOL · Permiso B — web de práctica

Web estática, responsive y sin backend. Incluye las 2.640 preguntas del banco, práctica por temas y los 88 simulacros originales.

## Subir a GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `aeol-permiso-b`).
2. Sube **todo el contenido de esta carpeta** a la raíz del repositorio (`index.html`, `app.js`, `styles.css`, `data/`, `images/`, etc.).
3. En GitHub entra en **Settings → Pages**.
4. En **Build and deployment**, elige **Deploy from a branch**.
5. Selecciona la rama `main` y la carpeta `/ (root)` y pulsa **Save**.
6. GitHub mostrará la URL pública cuando termine el despliegue.

## Datos y progreso

- El historial se guarda en `localStorage` del navegador.
- Si cambias de móvil/ordenador, el progreso no se sincroniza automáticamente.
- Reiniciar un test no borra los resultados anteriores.
- La media de fallos se normaliza a un test de 30 preguntas.

## Imágenes

Solo se muestra imagen cuando había una asociación exacta por simulacro + número de pregunta + preguntaCodigo en los archivos extraídos de AEOL. Las preguntas sin imagen asociada se muestran sin imagen.
