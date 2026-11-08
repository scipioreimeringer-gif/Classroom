// Opslag voor het klaslokaal: notities en canvassen van de docent (Upstash Redis via Vercel).
// Instellen in Vercel: Storage -> Upstash Redis koppelen, en Environment Variable KLAS_PASSWORD.
const KEY_RE = /^(notes|canvas:[a-z0-9]{1,24}|board:[a-z0-9]{1,24})$/;

function redisConf() {
  const env = process.env;
  let url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  let token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) {
    for (const k of Object.keys(env)) {
      if (!url && /REST_(API_)?URL$/.test(k)) url = env[k];
      if (!token && /REST_(API_)?TOKEN$/.test(k) && !/READ_ONLY/.test(k)) token = env[k];
    }
  }
  return url && token ? { url, token } : null;
}

async function redis(conf, cmd) {
  const r = await fetch(conf.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + conf.token, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function authed(req) {
  const p = process.env.KLAS_PASSWORD;
  return !!p && req.headers["x-klas-pass"] === p;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const conf = redisConf();
  if (req.method === "GET" && req.query && req.query.ping !== undefined) {
    return res.status(200).json({ ok: true, storage: !!conf, password: !!process.env.KLAS_PASSWORD, ai: !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) });
  }
  if (!authed(req)) return res.status(401).json({ error: "wachtwoord" });
  if (!conf) return res.status(500).json({ error: "Opslag is nog niet gekoppeld in Vercel" });
  try {
    if (req.method === "GET") {
      const key = String((req.query && req.query.key) || "");
      if (!KEY_RE.test(key)) return res.status(400).json({ error: "ongeldige sleutel" });
      const v = await redis(conf, ["GET", "klas:" + key]);
      return res.status(200).json({ value: v ? JSON.parse(v) : null });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const key = String(b.key || "");
      if (!KEY_RE.test(key)) return res.status(400).json({ error: "ongeldige sleutel" });
      const s = JSON.stringify(b.value === undefined ? null : b.value);
      if (s.length > 900000) return res.status(413).json({ error: "te groot" });
      await redis(conf, ["SET", "klas:" + key, s]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "methode niet toegestaan" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
