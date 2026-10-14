# PermisoB · Duolingo v13.3 · 87 simulacros, estadísticas y biblioteca

Actualización **sobre la web v12**, manteniendo su diseño y la estructura para publicar en Cloudflare Pages.

## Corrección de temas v13.3

- Los 18 temas contienen exactamente **2.610 preguntas**, cada una en un único tema; los 87 simulacros conservan sus 30 preguntas.
- Se han corregido **522 asignaciones temáticas** y sincronizado los contadores del banco. Se conservan textos, respuestas, explicaciones, identificadores e imágenes.
- El ZIP v13.2 recibido ya tenía 2.610 asignaciones: no se reproduce en ese archivo la suma comunicada de 1.980. Sus contadores de `topics.json` estaban desactualizados (sumaban 2.640); existían además preguntas asignadas al bloque equivocado. No se han inventado ni duplicado 630 preguntas.
- Se conservan XP, estadísticas, intentos, falladas, clases completadas y respuestas registradas. Las preguntas hechas que cambian de tema se reconocen en su nuevo tema. Los registros antiguos se conservan, pero las preguntas trasladadas no inflan el contador de su tema anterior.
- La migración se aplica una sola vez a cada estado antiguo, también al importar una copia o recuperar progreso remoto. Una nueva vuelta no recupera preguntas antiguas por error.
- Se mantiene la clave local `permisob_state_v11`, el identificador remoto y el Worker/Turso. **Publica en el mismo dominio y navegador** para continuar con el guardado local. En un dominio nuevo, exporta e importa tu copia de progreso desde Progreso.
- `COMPROBACION_v13_3.txt` documenta las verificaciones; `data/topic_changes_v13_3.json` detalla cada traslado y `data/classification_audit_v13_3.json` permite comprobar las 2.610 asignaciones.

## Novedades principales

- El banco contiene **87 simulacros x 30 preguntas = 2.610 preguntas**, todos del material reciente. Se ha retirado el simulacro 88 heredado de la v12, porque no figura entre los nuevos archivos.
- Se conservan los 18 temas, las clases visuales, las preguntas por temas, el entrenador de falladas, XP, rachas y la sincronización local/remota del diseño anterior.
- **Panel de seguimiento real de simulacros completos:** media general de fallos, media de los últimos 5, porcentaje de aprobados (0–3 fallos), porcentaje de pruebas en la meta ideal (0–1), gráfico de los últimos 12, historial y orientación sobre el ritmo de aprendizaje.
- Meta progresiva: **hasta 3 fallos para aprobar; 0–1 como objetivo ideal**. Se indica constancia cuando los últimos 5 simulacros tienen 0–1 fallos cada uno. Las prácticas cortas se excluyen de las medias de examen.
- **Biblioteca:** `TEMAS.pdf` (18 temas, 140 páginas), `INTENSIVO.pdf` (93 páginas), 15 fichas ilustradas, enlaces desde las clases y desde las explicaciones de preguntas. Se han optimizado los PDFs para la web sin cambiar la paginación.
- Estadística de temas más fallados a partir de las respuestas registradas desde esta versión; se migran las preguntas falladas por identificador y se mantiene el historial de simulacros anterior.
- Exportación/importación de una copia de progreso desde **Progreso** para cambiar de navegador o dispositivo.
- Filtros funcionales de simulacros: Todos, Pendientes, Hechos, Aprobados.
- Repaso de los errores específicos del simulacro terminado, en vez de mezclar todos los errores históricos.

## Instalación / actualizar la página anterior

1. **Haz copia de seguridad de tu web actual** antes de subir.
2. Descomprime este ZIP y publica **todo el contenido de esta carpeta en la raíz del mismo proyecto y dominio**. Deben quedar en la raíz `index.html`, `app.js`, `styles.css`, `enhancements.css`, `config.js`, `_worker.js` y las carpetas `data`, `images`, `study_pages`, `materiales`.
3. Si publicas en Cloudflare Pages con Turso, conserva en las variables/secretos del proyecto `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. No publiques el token en el frontend.
4. **Mantén el mismo dominio** si quieres conservar el progreso guardado en `localStorage` por la web v12 (clave `permisob_state_v11`). Esta versión utiliza deliberadamente la **misma** clave para no reiniciar tus logros.
5. En la página v13 entra en **Progreso → Descargar progreso** para guardar una copia. Si cambias de dominio/navegador, usa **Importar copia** en el destino. Un cambio de dominio por sí solo no transfiere `localStorage`.
6. Verifica en el panel **Progreso** que se han cargado 2.610 preguntas y prueba un simulacro, la Biblioteca y el contador de fallos.

## Pruebas locales

No abras directamente el `index.html` con `file://` porque el navegador puede bloquear la carga de JSON. Ejecuta en la carpeta descomprimida:

```bash
python3 -m http.server 8000
```

Y abre `http://localhost:8000`.

## Cómo funciona la media

La **media de fallos** = suma de errores de los simulacros completos de 30 preguntas / número de simulacros completados. Se cuenta cada intento terminado, incluso si repites el mismo simulacro. La media de los **últimos 5** se calcula con los 5 intentos más recientes. Las prácticas por temas de 5, 10, 30 o más preguntas **no se mezclan**, aunque una práctica tenga 30 preguntas, porque el modo no es `exam`.

**Ejemplo:** tres simulacros con 4, 2 y 1 fallo ⇒ media = 7/3 = 2,3 fallos. Estar por debajo de 3 de media no garantiza aprobar cada simulacro: por eso también se muestra la constancia de 5 tests consecutivos con 0–1 fallos.

La web muestra `—` cuando todavía no hay datos reales. **No se han creado resultados inventados.**

## Auditoría de fuentes y límites

- Los archivos aportados en octubre contienen 87 simulacros completos (2.610 preguntas). El simulacro 88 de la web previa se ha quitado del banco y de las pantallas. Si hay un resultado anterior del test 88 guardado en el navegador o Turso, **no se borra el historial**, pero ese examen antiguo no se incluye en las nuevas métricas de examen.
- En los primeros 87 simulacros cambian **35 posiciones de pregunta** respecto a la v12. El fichero `data/legacy_ids.json` facilita migrar registros fallados y preguntas practicadas.
- **10 preguntas de los nuevos ficheros** carecen de una explicación textual verificable tanto en la fuente nueva como en la versión anterior. Se mantiene su respuesta indicada por la fuente y, al corregir, se avisa de que no existe explicación de origen y se ofrece el manual del tema; no se inventa una justificación.
- El contenido didáctico es material del usuario. Las normas viales pueden cambiar: coteja dudas normativas con la DGT.
- El seguimiento por temas empieza a recopilar aciertos y errores individuales con esta v13; la v12 no almacenaba todos los resultados por pregunta.
- Una instalación pública para varios alumnos requiere autenticación real por usuario; `userKey` no es un sistema de login. Evita compartir información privada del progreso si publicas la web abiertamente.

## Estructura orientativa

```
index.html
app.js
styles.css
enhancements.css
config.js
_worker.js
data/
  questions.json
  topics.json
  study.json
  index.json
  materials.json
  legacy_ids.json
images/
study_pages/
materiales/
  Temas_PermisoB.pdf
  Intensivo_PermisoB.pdf
  ficha_tema_01.webp ... ficha_tema_15.webp
README_TURSO.txt
```

### Comprobacion de imagenes v13.2
Se contrastaron las 87 x 30 preguntas con `output2(1).zip`. Las 2.585 imagenes que trae el origen coinciden exactamente con los archivos web. Se sustituyeron 3 imagenes anteriores distintas y se quitaron 4 enlaces heredados en preguntas para las que el origen no suministra imagen. Son 25 preguntas sin imagen en total. No se modificaron las respuestas, textos ni resultados de los simulacros.
