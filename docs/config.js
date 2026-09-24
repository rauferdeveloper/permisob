window.PERMISOB_CONFIG = {
  // En Cloudflare Pages la API vive en el mismo dominio mediante _worker.js.
  // En local (file://) se mantiene solo el guardado del navegador.
  apiBase: /^https?:$/.test(window.location.protocol) ? window.location.origin : "",

  // Esta clave identifica TU progreso remoto. La web envía únicamente su SHA-256.
  // Si esta web va a ser pública para varias personas, conviene añadir login/PIN por usuario.
  userKey: "permisob_personal_raul",

  dailyGoalXp: 20,
  questionsUrl: "data/questions.json",
  topicsUrl: "data/topics.json"
};
