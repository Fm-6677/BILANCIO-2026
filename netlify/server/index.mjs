import { getDatabase } from "@netlify/database";

const db = getDatabase();
const MAX_BATCH = 5000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const idValido = (id) => (typeof id === "string" || typeof id === "number") && String(id).length > 0 && String(id).length <= 64;

function movimentoValido(m) {
  return m && typeof m === "object" && idValido(m.id) &&
    typeof m.tipo === "string" && typeof m.data === "string" &&
    typeof m.importo === "number" && isFinite(m.importo);
}

async function versione() {
  const [r] = await db.sql`
    SELECT
      (SELECT count(*) FROM movimenti)::text || '-' ||
      coalesce((SELECT extract(epoch FROM max(updated_at)) FROM movimenti)::text, '0') || '-' ||
      coalesce((SELECT extract(epoch FROM max(updated_at)) FROM impostazioni)::text, '0') AS v`;
  return r.v;
}

async function statoCompleto() {
  const righe = await db.sql`SELECT dati FROM movimenti ORDER BY CASE WHEN id ~ '^[0-9]+([.][0-9]+)?$' THEN id::numeric END, id`;
  const [cat] = await db.sql`SELECT valore FROM impostazioni WHERE chiave = 'categorie'`;
  return {
    versione: await versione(),
    movimenti: righe.map((r) => r.dati),
    categorie: cat ? cat.valore : null,
  };
}

async function sync(req) {
  let body;
  try { body = await req.json(); } catch { return json({ errore: "JSON non valido" }, 400); }
  const upsert = Array.isArray(body?.upsert) ? body.upsert : [];
  const elimina = Array.isArray(body?.elimina) ? body.elimina : [];
  if (upsert.length > MAX_BATCH || elimina.length > MAX_BATCH) return json({ errore: "Troppi elementi" }, 413);
  if (!upsert.every(movimentoValido) || !elimina.every(idValido)) return json({ errore: "Dati non validi" }, 400);
  const categorie = body?.categorie && typeof body.categorie === "object" && !Array.isArray(body.categorie) ? body.categorie : null;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const m of upsert) {
      await client.query(
        `INSERT INTO movimenti (id, dati, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET dati = EXCLUDED.dati, updated_at = now()`,
        [String(m.id), JSON.stringify(m)]
      );
    }
    if (elimina.length) {
      await client.query("DELETE FROM movimenti WHERE id = ANY($1::text[])", [elimina.map(String)]);
    }
    if (categorie) {
      await client.query(
        `INSERT INTO impostazioni (chiave, valore, updated_at) VALUES ('categorie', $1::jsonb, now())
         ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore, updated_at = now()`,
        [JSON.stringify(categorie)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return json(await statoCompleto());
}

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/dati" && req.method === "GET") {
      const v = await versione();
      if (url.searchParams.get("versione") === v) return json({ versione: v, invariato: true });
      return json(await statoCompleto());
    }
    if (url.pathname === "/api/sync" && req.method === "POST") return await sync(req);
    return json({ errore: "Non trovato" }, 404);
  } catch (e) {
    console.error(e);
    return json({ errore: "Errore del server" }, 500);
  }
};

export const config = { path: "/api/*" };
