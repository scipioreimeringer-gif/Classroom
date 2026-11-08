// AI-hulp in het klaslokaal. Werkt met OpenAI (ChatGPT) of Anthropic (Claude).
// Instellen in Vercel: Environment Variable OPENAI_API_KEY of ANTHROPIC_API_KEY (een van de twee is genoeg).
// Optioneel: OPENAI_MODEL (standaard gpt-5.4-mini) of ANTHROPIC_MODEL (standaard claude-haiku-5-5).
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

async function openai(system, user, maxTokens) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: maxTokens + 4000,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || "AI-fout " + r.status);
  return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
}

async function claude(system, user, maxTokens) {
  if (process.env.OPENAI_API_KEY && (!process.env.ANTHROPIC_API_KEY || process.env.AI_PROVIDER === "openai")) return openai(system, user, maxTokens);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || "AI-fout " + r.status);
  return (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
}

function parseJSON(t) {
  const m = t.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : t);
}

const SORT_SYSTEM = `Je bent een assistent voor een docent Nederlands als tweede taal (NT2).
Je sorteert Nederlandse woorden naar woordsoort en geeft de vormen die een NT2-leerling moet leren.
Antwoord ALLEEN met geldige JSON, zonder uitleg, in precies deze vorm:
{"werkwoorden":[{"infinitief":"","verleden":"ik-vorm verleden tijd, meervoud","hulpwerkwoord":"hebben of zijn of hebben/zijn","voltooid":"voltooid deelwoord","onregelmatig":true,"betekenis":""}],
 "zelfstandig":[{"woord":"","lidwoord":"de of het","meervoud":"","betekenis":""}],
 "bijvoeglijk":[{"woord":"","vergrotend":"","overtreffend":"","betekenis":""}],
 "overig":[{"woord":"","soort":"bijvoorbeeld bijwoord, voorzetsel, voegwoord, uitdrukking","betekenis":""}]}
Regels: zet werkwoorden in de infinitief en zelfstandig naamwoorden in het enkelvoud. Laat lidwoorden, namen en dubbele woorden weg.
"betekenis" is een korte Engelse vertaling (1 tot 4 woorden). Als de docent al een uitleg gaf, gebruik die.
Bij een vaste uitdrukking (bijvoorbeeld "zin hebben in"): zet die bij overig met soort "uitdrukking".`;

const REPORT_SYSTEM = `Je schrijft namens Scip, een vriendelijke docent Nederlands, een kort lesverslag voor WhatsApp aan een leerling.
Schrijf in eenvoudig Nederlands dat past bij het niveau van de leerling (bij A0/A1 heel eenvoudige korte zinnen, met een Engelse vertaling tussen haakjes bij moeilijke woorden).
Opbouw: begroeting met de naam, wat we vandaag deden (2 tot 4 korte punten), de nieuwe woorden (maximaal 10, met betekenis), het huiswerk, een korte positieve afsluiting. Onderteken met "Scip".
Gebruik geen gedachtestreepjes (geen — of –). Gebruik geen markdown-koppen, alleen eenvoudige opsommingstekens zoals "-" aan het begin van een regel. Verzin niets wat niet in de notities staat.`;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const p = process.env.KLAS_PASSWORD;
  if (!p || req.headers["x-klas-pass"] !== p) return res.status(401).json({ error: "wachtwoord" });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return res.status(500).json({ error: "AI staat nog niet aan: zet OPENAI_API_KEY of ANTHROPIC_API_KEY in Vercel" });
  if (req.method !== "POST") return res.status(405).json({ error: "methode niet toegestaan" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const level = String(b.level || "A2").slice(0, 3);
    if (b.task === "sort") {
      let input = "";
      if (Array.isArray(b.words) && b.words.length) {
        input = "Woorden (met uitleg van de docent als die er is):\n" +
          b.words.slice(0, 80).map((w) => "- " + String(w.nl || "").slice(0, 60) + (w.uit ? " = " + String(w.uit).slice(0, 60) : "")).join("\n");
      } else if (b.text) {
        input = "Haal uit deze lestekst de woorden die de leerling (niveau " + level + ") moet leren, maximaal 40, en sorteer ze:\n\n" + String(b.text).slice(0, 8000);
      } else return res.status(400).json({ error: "geen woorden" });
      const out = await claude(SORT_SYSTEM, input, 3000);
      const result = parseJSON(out);
      ["werkwoorden", "zelfstandig", "bijvoeglijk", "overig"].forEach((k) => { if (!Array.isArray(result[k])) result[k] = []; });
      return res.status(200).json({ result });
    }
    if (b.task === "report") {
      const words = (Array.isArray(b.words) ? b.words : []).slice(0, 30).map((w) => w.nl + (w.uit ? " = " + w.uit : "")).join("\n");
      const input = [
        "Naam leerling: " + String(b.name || "").slice(0, 40),
        "Niveau: " + level,
        b.goal ? "Doel: " + String(b.goal).slice(0, 200) : "",
        "Notities van de docent:\n" + (String(b.notes || "").slice(0, 3000) || "(geen)"),
        "Nieuwe woorden:\n" + (words || "(geen)"),
        "Huiswerk:\n" + (String(b.hw || "").slice(0, 1000) || "(geen)"),
        "Tekst uit het gedeelde canvas van de les:\n" + (String(b.canvas || "").slice(0, 6000) || "(leeg)"),
      ].filter(Boolean).join("\n\n");
      const out = await claude(REPORT_SYSTEM, input, 1200);
      return res.status(200).json({ result: out.replace(/[—–]/g, ",") });
    }
    return res.status(400).json({ error: "onbekende taak" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
