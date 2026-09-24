const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function dbHttpUrl(env) {
  const raw = String(env.TURSO_DATABASE_URL || "").trim();
  if (!raw) throw new Error("Falta TURSO_DATABASE_URL");
  return raw.replace(/^libsql:\/\//i, "https://").replace(/^http:\/\//i, "https://").replace(/\/$/, "");
}

function token(env) {
  const value = String(env.TURSO_AUTH_TOKEN || "").trim();
  if (!value) throw new Error("Falta TURSO_AUTH_TOKEN");
  return value;
}

function arg(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  return { type: "text", value: String(value) };
}

async function tursoExecute(env, sql, args = []) {
  const response = await fetch(`${dbHttpUrl(env)}/v2/pipeline`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token(env)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(arg) } },
        { type: "close" },
      ],
    }),
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`Respuesta no JSON de Turso (HTTP ${response.status})`); }

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Turso HTTP ${response.status}`);
  }

  const first = payload?.results?.[0];
  if (!first || first.type === "error") {
    throw new Error(first?.error?.message || "Turso devolvió un error");
  }
  return first?.response?.result || first?.response || {};
}

async function ensureSchema(env) {
  await tursoExecute(env, `
    CREATE TABLE IF NOT EXISTS user_state (
      user_hash TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

function cellValue(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer") return Number(cell.value);
  return cell.value;
}

async function getState(env, userHash) {
  const result = await tursoExecute(
    env,
    "SELECT state_json, updated_at FROM user_state WHERE user_hash = ? LIMIT 1",
    [userHash]
  );
  const row = result?.rows?.[0];
  if (!row) return null;
  return {
    state_json: cellValue(row[0]),
    updated_at: cellValue(row[1]),
  };
}

async function putState(env, userHash, state) {
  const now = Date.now();
  const stateJson = JSON.stringify(state);
  await tursoExecute(
    env,
    `INSERT INTO user_state (user_hash, state_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_hash) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
    [userHash, stateJson, now]
  );
  return now;
}

function validUserHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

async function api(request, env, url) {
  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "PermisoB Pages", time: new Date().toISOString() });
  }

  if (url.pathname === "/api/db-health") {
    try {
      await ensureSchema(env);
      const r = await tursoExecute(env, "SELECT 1 AS ok");
      return json({ ok: true, database: "connected", turso: true, rows: r?.rows?.length ?? 0 });
    } catch (error) {
      return json({ ok: false, database: "error", error: error.message }, 500);
    }
  }

  if (url.pathname === "/api/state") {
    try {
      await ensureSchema(env);

      if (request.method === "GET") {
        const user = url.searchParams.get("user");
        if (!validUserHash(user)) return json({ ok: false, error: "user inválido" }, 400);
        const found = await getState(env, user);
        if (!found) return json({ ok: true, state: null, updatedAt: null });
        let parsed = null;
        try { parsed = JSON.parse(found.state_json); }
        catch { parsed = found.state_json; }
        return json({ ok: true, state: parsed, updatedAt: found.updated_at });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => null);
        const user = body?.user;
        if (!validUserHash(user)) return json({ ok: false, error: "user inválido" }, 400);
        if (!body || typeof body.state !== "object" || body.state === null) {
          return json({ ok: false, error: "state inválido" }, 400);
        }
        const updatedAt = await putState(env, user, body.state);
        return json({ ok: true, saved: true, updatedAt });
      }

      return json({ ok: false, error: "Método no permitido" }, 405);
    } catch (error) {
      return json({ ok: false, error: error.message }, 500);
    }
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const response = await api(request, env, url);
      if (response) return response;
      return json({ ok: false, error: "API no encontrada" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
