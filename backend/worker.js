/**
 * MARKO PRO MASAX ULTRA — Cloudflare Worker backend
 * API keys stay in Worker secrets, never in the public frontend.
 */
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function reply(data, status, origin, allowedOrigin) {
  const headers = new Headers(jsonHeaders);
  // Only mirror an origin when it matches the configured allowlist.
  if (origin && origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://example.github.io';

    if (origin && origin !== allowedOrigin) {
      return reply({ error: 'Origin nicht erlaubt. Prüfe ALLOWED_ORIGIN in den Worker-Einstellungen.' }, 403, '', allowedOrigin);
    }
    if (request.method === 'OPTIONS') return reply({}, 204, origin, allowedOrigin);

    const url = new URL(request.url);
    if (request.method === 'GET') {
      return reply({ ok: true, service: 'MARKO PRO MASAX ULTRA API', endpoint: '/chat', configured: Boolean(env.OPENAI_API_KEY) }, 200, origin, allowedOrigin);
    }
    if (request.method !== 'POST' || !url.pathname.endsWith('/chat')) {
      return reply({ error: 'Route nicht gefunden. Verwende GET für Status oder POST auf /chat.' }, 404, origin, allowedOrigin);
    }
    if (!env.OPENAI_API_KEY) return reply({ error: 'OPENAI_API_KEY fehlt. Lege ihn als Worker Secret an.' }, 503, origin, allowedOrigin);

    const length = Number(request.headers.get('Content-Length') || '0');
    if (length > 80000) return reply({ error: 'Die Anfrage ist zu groß. Bitte kürze den Chat oder die Datei.' }, 413, origin, allowedOrigin);

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 80000) return reply({ error: 'Die Anfrage ist zu groß (Limit 80 KB).' }, 413, origin, allowedOrigin);
      body = JSON.parse(raw);
    } catch {
      return reply({ error: 'Ungültiger JSON-Request.' }, 400, origin, allowedOrigin);
    }

    if (!body || !Array.isArray(body.messages)) return reply({ error: 'Es fehlt die messages-Liste.' }, 400, origin, allowedOrigin);
    const messages = body.messages.slice(-18).map(message => {
      const role = message?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof message?.content === 'string' ? message.content.slice(0, 18000) : '';
      return { role, content };
    }).filter(message => message.content.trim());
    if (!messages.length) return reply({ error: 'Bitte sende eine Textnachricht.' }, 400, origin, allowedOrigin);

    const assistantName = typeof body.assistantName === 'string' ? body.assistantName.slice(0, 32) : 'Marko';
    const systemPrompt = `Du bist ${assistantName}, ein hilfreicher, kreativer, ehrlicher und sicherheitsbewusster KI-Assistent in der Web-App MARKO PRO MASAX ULTRA. Antworte standardmäßig auf Deutsch, passe dich der Sprache des Nutzers an, erkläre komplexe Themen verständlich und liefere konkrete, sorgfältig strukturierte Ergebnisse. Du hast ein Websuch-Werkzeug: Nutze es bei aktuellen, veränderlichen oder unbekannten Informationen (zum Beispiel HSV-News, Spielpläne, Tabellen, Wetter, Nachrichten, Preise, Softwareversionen und öffentliche Fakten). Beantworte einfache zeitlose Fragen direkt, wenn keine Suche nötig ist. Nenne bei recherchierten Antworten das Datum, trenne Fakten von Unsicherheit und zitiere verlässliche Quellen. Erfinde keine Fakten, Quellen, Fähigkeiten oder ausgeführten Aktionen. Bei Code: liefere vollständige, nachvollziehbare Beispiele, nenne Voraussetzungen und vermeide unsichere Praktiken. Frage nur nach Details, die wirklich nötig sind; mache sonst vernünftige Annahmen. Behaupte nicht, Webseiten oder externe Systeme geprüft zu haben, wenn du das nicht getan hast.`;

    const model = env.OPENAI_MODEL || 'gpt-4.1-mini';
    let upstream;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          instructions: systemPrompt,
          input: messages,
          tools: [{ type: 'web_search', search_context_size: 'medium' }],
          include: ['web_search_call.action.sources'],
          store: false
        })
      });
    } catch {
      return reply({ error: 'Das KI-Angebot ist gerade nicht erreichbar. Bitte versuche es später erneut.' }, 502, origin, allowedOrigin);
    }

    let result;
    try { result = await upstream.json(); }
    catch { return reply({ error: 'Die KI hat eine ungültige Antwort geliefert.' }, 502, origin, allowedOrigin); }

    if (!upstream.ok) {
      // Keep the provider's response details out of public client errors.
      const providerMessage = result?.error?.message;
      const status = upstream.status === 429 ? 429 : 502;
      return reply({ error: upstream.status === 429 ? 'Das KI-Nutzungslimit wurde erreicht. Bitte prüfe Kontingent und Abrechnung.' : `Die KI-Anfrage ist fehlgeschlagen${providerMessage ? `: ${String(providerMessage).slice(0, 180)}` : '.'}` }, status, origin, allowedOrigin);
    }

    let answer = typeof result.output_text === 'string' ? result.output_text : '';
    if (!answer && Array.isArray(result.output)) {
      answer = result.output.flatMap(item => Array.isArray(item.content) ? item.content : []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n');
    }
    if (!answer.trim()) return reply({ error: 'Die KI hat keinen Text zurückgegeben.' }, 502, origin, allowedOrigin);

    // Surface web citations as clickable Markdown links because a plain-text frontend
    // cannot display the Responses API's annotation objects automatically.
    const citations = [];
    for (const item of (Array.isArray(result.output) ? result.output : [])) {
      for (const part of (Array.isArray(item.content) ? item.content : [])) {
        for (const annotation of (Array.isArray(part.annotations) ? part.annotations : [])) {
          const url = typeof annotation.url === 'string' ? annotation.url : annotation.url_citation?.url;
          const title = typeof annotation.title === 'string' ? annotation.title : annotation.url_citation?.title;
          if (typeof url === 'string' && /^https:\/\//i.test(url) && !citations.some(source => source.url === url)) {
            citations.push({ title: (typeof title === 'string' && title.trim() ? title.trim() : new URL(url).hostname).slice(0, 180), url });
          }
        }
      }
    }
    const sourceBlock = citations.length ? `\n\n### Quellen\n${citations.slice(0, 6).map(source => `- [${source.title.replace(/[\[\]]/g, '')}](${source.url})`).join('\n')}` : '';
    return reply({ reply: `${answer.trim()}${sourceBlock}`, model, webSearchEnabled: true, sources: citations.slice(0, 6) }, 200, origin, allowedOrigin);
  }
};
