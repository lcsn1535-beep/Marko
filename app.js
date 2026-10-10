(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORE = { chats: 'marko_ultra_chats_v1', notes: 'marko_ultra_notes_v1', endpoint: 'marko_ultra_endpoint_v1', name: 'marko_ultra_name_v1' };
  const config = window.MARKO_CONFIG || {};
  const state = {
    chats: readStore(STORE.chats, []), notes: readStore(STORE.notes, []),
    endpoint: localStorage.getItem(STORE.endpoint) || config.apiEndpoint || '',
    name: localStorage.getItem(STORE.name) || config.assistantName || 'Marko',
    currentId: null, messages: [], attachedFile: null, busy: false, toastTimer: null
  };
  const welcomePanel = $('#welcomePanel');
  const messagesEl = $('#messages');
  const messageInput = $('#messageInput');
  const fileInput = $('#fileInput');

  function readStore(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; }
    catch { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { showToast('Der Browser-Speicher ist voll oder blockiert.'); }
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function renderMarkdown(source) {
    let text = escapeHTML(source || '');
    const codeBlocks = [];
    text = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
      const index = codeBlocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`) - 1;
      return `@@MARKOCODE${index}@@`;
    });
    const lines = text.split('\n');
    const out = [];
    let paragraph = [];
    let listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const flushParagraph = () => {
      if (paragraph.length) {
        const content = paragraph.join('<br>');
        out.push(`<p>${inlineMarkdown(content)}</p>`);
        paragraph = [];
      }
    };
    for (const line of lines) {
      const codeMatch = line.match(/^@@MARKOCODE(\d+)@@$/);
      if (codeMatch) { flushParagraph(); closeList(); out.push(`@@MARKOCODE${codeMatch[1]}@@`); continue; }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      if (heading) { flushParagraph(); closeList(); const n = heading[1].length; out.push(`<h${n}>${inlineMarkdown(heading[2])}</h${n}>`); continue; }
      if (bullet || numbered) {
        flushParagraph(); const wanted = bullet ? 'ul' : 'ol';
        if (listType !== wanted) { closeList(); out.push(`<${wanted}>`); listType = wanted; }
        out.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`); continue;
      }
      closeList(); paragraph.push(line);
    }
    flushParagraph(); closeList();
    return out.join('').replace(/@@MARKOCODE(\d+)@@/g, (_m, n) => codeBlocks[Number(n)] || '');
  }
  function inlineMarkdown(text) {
    return text
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function timeLabel(timestamp = Date.now()) {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  }
  function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function setStatus(connected, label) {
    const badge = $('#connectionStatus');
    badge.classList.toggle('connected', connected);
    badge.innerHTML = `<span class="status-dot"></span><span>${escapeHTML(label)}</span>`;
    $('#modeLabel').textContent = connected ? 'KI-BACKEND AKTIV' : 'DEMO-MODUS';
  }
  function refreshMode() { setStatus(Boolean(state.endpoint), state.endpoint ? 'BACKEND KONFIGURIERT' : 'LOKAL BEREIT'); }
  function switchView(viewName) {
    const mapping = { chat: 'chatView', tools: 'toolsView', library: 'libraryView' };
    Object.entries(mapping).forEach(([key, id]) => {
      const view = document.getElementById(id); const active = key === viewName;
      view.hidden = !active; view.classList.toggle('active', active);
    });
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
    $('#pageHeading').textContent = ({ chat: state.messages.length ? 'KONVERSATION' : 'NEUER CHAT', tools: 'WERKZEUGE', library: 'MEINE NOTIZEN' })[viewName];
    $('#sidebar').classList.remove('open');
    if (viewName === 'library') renderNotes();
  }
  function updateWelcome() {
    const showWelcome = state.messages.length === 0;
    welcomePanel.hidden = !showWelcome;
    messagesEl.hidden = showWelcome;
    $('#pageHeading').textContent = showWelcome ? 'NEUER CHAT' : 'KONVERSATION';
  }
  function renderAllMessages() {
    messagesEl.innerHTML = '';
    state.messages.forEach((message, index) => messagesEl.appendChild(createMessageNode(message, index)));
    updateWelcome();
    scrollToLatest();
  }
  function createMessageNode(message, index) {
    const article = document.createElement('article');
    article.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
    const isUser = message.role === 'user';
    const name = isUser ? 'DU' : state.name;
    const avatar = isUser ? 'D' : 'M';
    const body = document.createElement('div'); body.className = 'message-body';
    const meta = document.createElement('div'); meta.className = 'message-meta';
    meta.innerHTML = `<b>${escapeHTML(name)}</b><time>${escapeHTML(timeLabel(message.time))}</time>`;
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    if (isUser) bubble.textContent = message.content;
    else bubble.innerHTML = renderMarkdown(message.content);
    body.append(meta, bubble);
    if (!isUser) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      actions.innerHTML = `<button type="button" data-action="copy" data-index="${index}">▣ Kopieren</button><button type="button" data-action="note" data-index="${index}">＋ Als Notiz speichern</button>`;
      body.appendChild(actions);
    }
    const icon = document.createElement('div'); icon.className = 'message-avatar'; icon.textContent = avatar;
    article.append(icon, body);
    if (isUser) article.appendChild(body), article.appendChild(icon); // Benutzer-Layout: Avatar rechts
    return article;
  }
  function scrollToLatest() { requestAnimationFrame(() => { const wrap = $('#conversationWrap'); wrap.scrollTop = wrap.scrollHeight; window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }); }
  function showTyping() {
    const node = document.createElement('article'); node.className = 'message assistant'; node.id = 'typingIndicator';
    node.innerHTML = `<div class="message-avatar">M</div><div class="message-body"><div class="message-meta"><b>${escapeHTML(state.name)}</b><time>denkt nach</time></div><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    messagesEl.appendChild(node); updateWelcome(); scrollToLatest();
  }
  function removeTyping() { $('#typingIndicator')?.remove(); }
  function persistCurrent() {
    if (!state.messages.length) return;
    const firstUser = state.messages.find(m => m.role === 'user');
    const chat = { id: state.currentId || makeId(), title: (firstUser?.content || 'Neue Unterhaltung').split('\n')[0].slice(0, 42), updatedAt: Date.now(), messages: state.messages };
    state.currentId = chat.id;
    state.chats = [chat, ...state.chats.filter(c => c.id !== chat.id)].slice(0, 35);
    writeStore(STORE.chats, state.chats); renderHistory();
  }
  function renderHistory() {
    const list = $('#historyList'); list.innerHTML = '';
    if (!state.chats.length) { list.innerHTML = '<div class="history-empty">Deine Unterhaltungen<br>erscheinen hier.</div>'; return; }
    state.chats.forEach(chat => {
      const button = document.createElement('button'); button.className = `history-item ${chat.id === state.currentId ? 'current' : ''}`; button.textContent = chat.title || 'Neue Unterhaltung'; button.title = chat.title;
      button.addEventListener('click', () => openChat(chat.id)); list.appendChild(button);
    });
  }
  function openChat(id) {
    const chat = state.chats.find(c => c.id === id); if (!chat) return;
    state.currentId = chat.id; state.messages = [...chat.messages]; renderAllMessages(); renderHistory(); switchView('chat');
  }
  function newChat() {
    state.currentId = null; state.messages = []; state.attachedFile = null; $('#fileContext').hidden = true; messageInput.value = ''; resizeInput();
    renderAllMessages(); renderHistory(); switchView('chat'); messageInput.focus();
  }
  function addMessage(role, content) {
    const message = { role, content, time: Date.now() };
    state.messages.push(message); messagesEl.appendChild(createMessageNode(message, state.messages.length - 1)); updateWelcome(); persistCurrent(); scrollToLatest(); return message;
  }
  function recentMessages() {
    const max = Number(config.maxHistoryMessages) || 18;
    return state.messages.slice(-max).map(m => ({ role: m.role, content: m.content }));
  }
  async function sendMessage(textOverride) {
    if (state.busy) return;
    let text = (typeof textOverride === 'string' ? textOverride : messageInput.value).trim();
    if (state.attachedFile) {
      text += `\n\n[Angehängte Datei: ${state.attachedFile.name}]\n${state.attachedFile.text}`;
    }
    if (!text) return;
    state.attachedFile = null; $('#fileContext').hidden = true; fileInput.value = '';
    messageInput.value = ''; resizeInput();
    addMessage('user', text);
    state.busy = true; $('#sendBtn').disabled = true; showTyping();
    try {
      let reply;
      // Live weather works directly from GitHub Pages and does not require an AI API key.
      if (isWeatherQuestion(text)) reply = await liveWeatherReply(text);
      else if (state.endpoint) reply = await askBackend();
      // In offline/demo mode, use a free encyclopedia API for factual lookups.
      else if (isInfoLookupRequest(text)) reply = await wikipediaReply(text);
      else reply = await demoReply(text);
      removeTyping(); addMessage('assistant', reply); persistCurrent();
    } catch (error) {
      removeTyping();
      const message = `Die Anfrage ist fehlgeschlagen: ${error.message || 'Unbekannter Fehler'}.\n\nPrüfe die Backend-URL und ob dein Backend erreichbar ist. Im Demo-Modus kannst du Marko auch ohne Backend ausprobieren.`;
      addMessage('assistant', message); showToast('Die KI-Anfrage konnte nicht abgeschlossen werden.');
    } finally { state.busy = false; $('#sendBtn').disabled = false; messageInput.focus(); }
  }
  async function askBackend() {
    const endpoint = state.endpoint.replace(/\/$/, '');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: recentMessages(), assistantName: state.name }), signal: controller.signal
      });
      let data = {}; try { data = await response.json(); } catch { /* no JSON body */ }
      if (!response.ok) throw new Error(data.error || `Server antwortete mit ${response.status}`);
      const answer = data.reply || data.output_text || data.message;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Das Backend hat keine Antwort geliefert.');
      return answer.trim();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Zeitüberschreitung nach 60 Sekunden');
      if (error instanceof TypeError) throw new Error('Verbindung nicht möglich. Prüfe URL und CORS-Einstellungen.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function safeCalculate(raw) {
    let expression = raw.trim().replace(/,/g, '.').replace(/[×x]/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**');
    expression = expression.replace(/^(bitte\s+)?(rechne|berechne|was ist|wieviel ist|wie viel ist)\s*/i, '').replace(/\s*(aus|bitte)\s*\??$/i, '').replace(/€|eur|euro/gi, '').trim();
    if (!expression || !/^[\d\s.+*/()%*-]+$/.test(expression) || /\*\*/.test(expression)) return null;
    // Small recursive-descent parser: no eval(), Function() or executable user input.
    const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
    if (tokens.join('') !== expression.replace(/\s/g, '')) return null;
    let pos = 0;
    function atom() {
      const token = tokens[pos++];
      if (token === '+') return atom();
      if (token === '-') return -atom();
      if (token === '(') { const value = addSub(); if (tokens[pos++] !== ')') throw new Error('Klammer fehlt'); return value; }
      const n = Number(token); if (!Number.isFinite(n)) throw new Error('Zahl ungültig'); return n;
    }
    function mulDiv() { let v = atom(); while (['*', '/', '%'].includes(tokens[pos])) { const op = tokens[pos++]; const b = atom(); if ((op === '/' || op === '%') && b === 0) throw new Error('Division durch 0'); v = op === '*' ? v * b : op === '/' ? v / b : v % b; } return v; }
    function addSub() { let v = mulDiv(); while (['+', '-'].includes(tokens[pos])) { const op = tokens[pos++]; const b = mulDiv(); v = op === '+' ? v + b : v - b; } return v; }
    try { const result = addSub(); if (pos !== tokens.length || !Number.isFinite(result)) return null; return result; } catch { return null; }
  }
  function isWeatherQuestion(text) {
    return /\b(wetter|temperatur|temperaturen|regnet|regenwahrscheinlichkeit|regenradar|windgeschwindigkeit|wetterbericht|vorhersage)\b/i.test(text);
  }
  function extractWeatherPlace(text) {
    const match = text.match(/\b(?:in|für|bei)\s+(.+?)(?=[?!.,]|$)/i);
    if (!match) return '';
    return match[1]
      .replace(/\b(heute|morgen|übermorgen|jetzt|aktuell|diese woche|nächste woche|am wochenende)\b.*$/i, '')
      .replace(/\b(bitte|mal|eigentlich)\b/gi, '')
      .trim();
  }
  function locationAliases(place) {
    return !place || /^(hier|hig|bei mir|mein(?:em|en)? standort|meiner nähe|in meiner nähe|aktueller standort)$/i.test(place.trim());
  }
  function getBrowserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Dieser Browser unterstützt keine Standortabfrage.'));
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, name: 'dein aktueller Standort' }),
        error => reject(new Error(error.code === 1 ? 'Standortzugriff wurde nicht erlaubt. Erlaube ihn im Browser oder schreibe einen Stadtnamen in deine Wetterfrage.' : 'Standort konnte nicht ermittelt werden. Schreibe stattdessen einen Stadtnamen in deine Wetterfrage.')),
        { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 }
      );
    });
  }
  async function resolveWeatherPlace(place) {
    if (locationAliases(place)) return getBrowserLocation();
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=8&language=de&format=json`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Der Ortsdienst ist gerade nicht erreichbar. Bitte versuche es erneut.');
    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      if (/^(hig|hier|bei mir)$/i.test(place.trim())) return getBrowserLocation();
      throw new Error(`Ich finde den Ort „${place}“ nicht. Schreibe bitte den Namen einer Stadt oder erlaube die Standortabfrage mit „hier“.`);
    }
    const chosen = results.find(item => item.country_code === 'DE') || results[0];
    const placeParts = [chosen.name, chosen.admin1, chosen.country].filter((value, index, arr) => value && arr.indexOf(value) === index);
    return { latitude: chosen.latitude, longitude: chosen.longitude, name: placeParts.join(', ') };
  }
  function weatherDescription(code) {
    const descriptions = {
      0: 'Klarer Himmel', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bedeckt',
      45: 'Nebel', 48: 'Nebel mit Reifablagerung', 51: 'Leichter Nieselregen', 53: 'Mäßiger Nieselregen', 55: 'Starker Nieselregen',
      56: 'Gefrierender leichter Nieselregen', 57: 'Gefrierender starker Nieselregen', 61: 'Leichter Regen', 63: 'Mäßiger Regen', 65: 'Starker Regen',
      66: 'Leichter gefrierender Regen', 67: 'Starker gefrierender Regen', 71: 'Leichter Schneefall', 73: 'Mäßiger Schneefall', 75: 'Starker Schneefall',
      77: 'Schneegriesel', 80: 'Leichte Regenschauer', 81: 'Mäßige Regenschauer', 82: 'Starke Regenschauer', 85: 'Leichte Schneeschauer',
      86: 'Starke Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit leichtem Hagel', 99: 'Gewitter mit starkem Hagel'
    };
    return descriptions[Number(code)] || 'Wetterzustand nicht verfügbar';
  }
  function windDirection(degrees) {
    const names = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(Number(degrees || 0) / 45) % 8];
  }
  async function liveWeatherReply(userText) {
    try {
      const place = await resolveWeatherPlace(extractWeatherPlace(userText));
      const params = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
        timezone: 'auto', forecast_days: '1'
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Der Wetterdienst ist gerade nicht erreichbar. Bitte versuche es erneut.');
      const data = await response.json();
      const current = data.current || {}; const daily = data.daily || {};
      const fmt = (value, digits = 0) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(Number(value)) : '–';
      const clock = value => typeof value === 'string' && value.includes('T') ? value.split('T')[1].slice(0, 5) : '–';
      const date = current.time ? current.time.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const rain = daily.precipitation_probability_max?.[0];
      const min = daily.temperature_2m_min?.[0]; const max = daily.temperature_2m_max?.[0];
      const rise = daily.sunrise?.[0]; const set = daily.sunset?.[0];
      return `## 🌦️ Wetter für ${place.name}\n\n**Stand:** ${date}${current.time ? `, ${clock(current.time)} Ortszeit` : ''} · Daten live abgerufen\n\n- **Jetzt:** ${weatherDescription(current.weather_code)}\n- **Temperatur:** ${fmt(current.temperature_2m, 1)} °C (gefühlt ${fmt(current.apparent_temperature, 1)} °C)\n- **Heute:** ${fmt(min, 1)} bis ${fmt(max, 1)} °C\n- **Regenwahrscheinlichkeit heute:** ${rain == null ? '–' : `${fmt(rain)} %`}\n- **Niederschlag aktuell:** ${fmt(current.precipitation, 1)} mm\n- **Wind:** ${fmt(current.wind_speed_10m)} km/h aus ${windDirection(current.wind_direction_10m)}\n- **Luftfeuchtigkeit:** ${fmt(current.relative_humidity_2m)} %\n- **Sonnenaufgang / Sonnenuntergang:** ${clock(rise)} / ${clock(set)}\n\n*Quelle: [Open-Meteo](https://open-meteo.com/). Für den lokalen Wetterbericht habe ich nur bei dieser Wetterfrage den genannten Ort beziehungsweise – bei „hier“ oder „hig“ – nach deiner Browser-Erlaubnis deinen Standort verwendet.*`;
    } catch (error) {
      return `## Wetterabfrage nicht abgeschlossen\n\n${error.message || 'Der Wetterdienst hat nicht geantwortet.'}\n\nDu kannst zum Beispiel **„Wetter heute in Hamburg“** schreiben oder **„Wetter heute hier“** verwenden und den Standortzugriff im Browser erlauben.`;
    }
  }
  function isInfoLookupRequest(text) {
    return /\b(hsv|hamburger sv|wer ist|wer war|was ist|was sind|infos?\s+(?:über|zu|zum|zur|vom)|informationen?\s+(?:über|zu|zum|zur)|fakten\s+(?:über|zu)|geschichte\s+von|erklär(?:e)?\s+(?:mir\s+)?|erzähl(?:e)?\s+(?:mir\s+)?(?:etwas|was)\s+über|wikipedia)\b/i.test(text);
  }
  function wikipediaSearchTerm(text) {
    if (/\b(hsv|hamburger sv)\b/i.test(text)) return 'Hamburger SV';
    return text
      .replace(/^\s*(?:bitte\s+)?(?:gib\s+mir\s+)?(?:ein paar\s+)?(?:aktuelle\s+)?(?:infos?|informationen|fakten)\s+(?:über|zum|zur|zu|vom|von der|von dem)\s+/i, '')
      .replace(/^\s*(?:bitte\s+)?(?:erklär(?:e)?|erzähl(?:e)?)\s+(?:mir\s+)?(?:etwas|was)?\s*(?:über|zu|zum|zur)?\s*/i, '')
      .replace(/^\s*(?:wer ist|wer war|was ist|was sind|geschichte von|wikipedia)\s+/i, '')
      .replace(/[?!.,]+$/g, '').trim().slice(0, 140);
  }
  async function wikipediaReply(userText) {
    const term = wikipediaSearchTerm(userText);
    if (!term) return demoReply(userText);
    try {
      const url = `https://de.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=1&prop=extracts%7Cinfo&exintro=1&explaintext=1&inprop=url&format=json&formatversion=2&origin=*`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Wikipedia ist gerade nicht erreichbar.');
      const data = await response.json();
      const pages = data?.query?.pages;
      const page = Array.isArray(pages) ? pages[0] : Object.values(pages || {})[0];
      if (!page || !page.extract) return `Ich konnte in der freien Enzyklopädie keinen passenden Artikel für **„${term}“** finden.\n\nFür aktuelle Nachrichten, Sporttabellen und weitere Live-Recherche verbinde Marko mit dem KI-Backend in **Einstellungen & Setup**.`;
      const extract = page.extract.trim().slice(0, 3500);
      return `## ${page.title}\n\n${extract}\n\n**Quelle:** [Wikipedia: ${page.title}](${page.fullurl || `https://de.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`})\n\n*Das ist ein Enzyklopädie-Auszug, keine Live-Nachrichten. Für aktuelle HSV-Ergebnisse, Tabellenstände oder andere tagesaktuelle Informationen verbinde das KI-Backend mit aktivierter Websuche.*`;
    } catch {
      return `Ich konnte gerade keine Wissensdatenbank erreichen. Prüfe deine Internetverbindung. Wetterabfragen funktionieren separat; für umfangreiche Web-Recherche kannst du das KI-Backend verbinden.`;
    }
  }

  async function demoReply(userText) {
    await new Promise(resolve => setTimeout(resolve, 550 + Math.random() * 500));
    const normalized = userText.toLowerCase();
    const math = safeCalculate(userText);
    if (math !== null) return `## Ergebnis\n\n**${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 8 }).format(math)}**\n\nIch habe den Ausdruck lokal berechnet. Für komplexe Fragen oder Aufgaben verbinde Marko über **Einstellungen → KI-Backend-URL** mit einem Sprachmodell.`;
    if (/^(hi|hey|hallo|moin|servus|guten morgen|guten tag|guten abend|yo)\b/i.test(userText.trim())) return `Hey! 👋 Ich bin **${state.name}**, dein digitaler Co-Pilot.\n\nGerade laufe ich im **Demo-Modus**: Oberfläche, Chat-Verlauf, Notizen, Textdateien und kleine lokale Helfer funktionieren schon. Mit einem verbundenen KI-Backend kann ich echte Modellantworten geben.\n\nWas hast du vor?`;
    if (/(wer bist du|was kannst du|hilfe|wie funktioniert|was ist marko)/i.test(normalized)) return `## Das ist ${state.name} ✦\n\nIch bin dein persönlicher Assistent in **MARKO PRO MASAX ULTRA**. Diese Website enthält bereits:\n\n- **Chat & Verlauf** — Unterhaltungen bleiben in deinem Browser gespeichert.\n- **Werkzeuge** — Ideen, Texte, Coding, Lernen, Planung und Analyse als Startpunkte.\n- **Notizen** — Antworten kannst du ins persönliche Ideen-Archiv übernehmen.\n- **Datei-Kontext** — Textdateien wie TXT, MD, CSV, JSON und Quellcode lassen sich anhängen.\n- **Lokaler Rechner** — einfache Rechenausdrücke funktionieren ohne Server.\n\n**Wichtig:** Aktuell ist kein echtes KI-Modell verbunden. Öffne unten links **Einstellungen & Setup**, trage die URL eines bereitgestellten Backends ein und speichere. Die Anleitung steht in der README.`;
    if (/(datum|uhrzeit|wie spät|welcher tag|heute)/i.test(normalized) && normalized.length < 90) {
      const now = new Date(); return `Lokal auf deinem Gerät ist es gerade **${new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short' }).format(now)}**.\n\nDas kommt von deinem Browser, nicht von einem verbundenen KI-Modell.`;
    }
    if (/(zusammenfass|fasse|kurzfassung|analysiere diese datei|inhalt der datei)/i.test(normalized) && /\[angehängte datei:/i.test(userText)) {
      const content = userText.split(/\[angehängte datei:[^\]]+\]\n/i).slice(1).join('\n');
      const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);
      const words = content.trim().split(/\s+/).filter(Boolean);
      return `## Lokale Datei-Übersicht\n\n- **Wörter:** ${words.length}\n- **Zeichen:** ${content.length}\n- **Absätze:** ${content.split(/\n\s*\n/).filter(p => p.trim()).length}\n\n**Anfang des Inhalts:**\n${sentences.slice(0, 4).join(' ').slice(0, 950) || 'Die Datei enthält keinen lesbaren Text.'}\n\n*Das ist eine einfache lokale Vorschau, keine semantische KI-Zusammenfassung. Für eine echte Analyse verbinde ein KI-Backend.*`;
    }
    if (/(ideen|brainstorm|website|projekt|plan|mach mir|erstelle|design)/i.test(normalized)) {
      const topic = userText.replace(/[.!?]+$/, '').slice(0, 130);
      return `## Lass uns das strukturiert angehen ✦\n\nFür **„${topic}“** würde ich mit diesem Mini-Plan starten:\n\n1. **Ziel festlegen** — Was soll am Ende funktionieren oder entstehen?\n2. **Version 1 bauen** — Die drei wichtigsten Funktionen zuerst, statt alles gleichzeitig anzufangen.\n3. **Look & Feel definieren** — Farben, Typografie und ein klares Layout festlegen.\n4. **Testen** — Auf Handy und Desktop prüfen, Fehler sammeln und verbessern.\n5. **Ausbauen** — Erst danach Extras hinzufügen.\n\n**Hinweis:** Ich bin noch im Demo-Modus und habe deine Anfrage nicht von einem großen Sprachmodell bearbeiten lassen. Verbinde ein Backend, damit ich einen individuellen Entwurf mit konkreten Inhalten und Code ausarbeiten kann.`;
    }
    if (/(text|schreib|formuli|übersetz|verbesser|umformulier)/i.test(normalized)) {
      return `## Text-Studio ✎\n\nIch kann den eigentlichen Schreibauftrag erst mit einem verbundenen Sprachmodell zuverlässig ausführen. Bis dahin hilft diese kleine Vorlage:\n\n**Ziel:** Was soll der Text erreichen?\n\n**Zielgruppe:** Für wen ist er gedacht?\n\n**Ton:** Locker, professionell, lustig oder überzeugend?\n\n**Format:** Nachricht, Website, Bewerbung, Social Post oder etwas anderes?\n\nBeschreibe diese Punkte in einer Nachricht und aktiviere danach das KI-Backend — dann kann ${state.name} den Text wirklich erstellen.`;
    }
    if (/(code|programmier|javascript|python|html|css|fehler|bug)/i.test(normalized)) {
      return `## Code-Labor ⌘\n\nFür eine echte Codeanalyse und korrekte Lösung brauche ich ein verbundenes KI-Modell. Ein guter Debugging-Auftrag enthält:\n\n1. **Was soll passieren?**\n2. **Was passiert stattdessen?**\n3. **Fehlermeldung und betroffener Code** (bitte Geheimnisse und Passwörter entfernen).\n4. **Umgebung:** Sprache, Framework und Version.\n\nDann kann eine KI gezielt nach der Ursache suchen. Im aktuellen Demo-Modus erfinde ich lieber keine vermeintlich sichere Lösung.`;
    }
    return `Ich habe deine Nachricht erhalten. ✦\n\n**Aktueller Status:** Marko läuft gerade ohne echtes Sprachmodell. Ich kann einfache Rechenaufgaben lokal lösen und dir die Oberfläche, Notizen und den Verlauf bereitstellen; komplexes Denken, Recherche und maßgeschneiderte Antworten sind im Demo-Modus nicht aktiv.\n\n**Für die volle KI-Funktion:** Öffne **Einstellungen & Setup**, verbinde einen Backend-Endpunkt und probiere deine Frage erneut. Die Datei [1mREADME.md[0m erklärt die Einrichtung Schritt für Schritt.`;
  }
  function openSettings() {
    $('#backendUrl').value = state.endpoint; $('#assistantName').value = state.name;
    $('#settingsFeedback').textContent = ''; $('#settingsModal').hidden = false; $('#backendUrl').focus();
  }
  function closeSettings() { $('#settingsModal').hidden = true; }
  async function testBackend() {
    const endpoint = $('#backendUrl').value.trim().replace(/\/$/, '');
    const feedback = $('#settingsFeedback');
    if (!endpoint) { feedback.textContent = 'Bitte zuerst die URL deines Backends eintragen.'; return; }
    feedback.textContent = 'Verbindung wird geprüft …';
    try {
      const response = await fetch(endpoint, { method: 'GET', headers: { 'Accept': 'application/json' } });
      let data = {}; try { data = await response.json(); } catch { /* ignored */ }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      feedback.textContent = `Verbindung erfolgreich${data.service ? ` — ${data.service}` : ''}. Noch nicht gespeichert.`;
    } catch (error) { feedback.textContent = `Verbindung fehlgeschlagen: ${error.message || 'Bitte URL/CORS prüfen.'}`; }
  }
  function saveSettings() {
    const url = $('#backendUrl').value.trim();
    if (url && !/^https:\/\//i.test(url)) { $('#settingsFeedback').textContent = 'Bitte eine HTTPS-URL eintragen.'; return; }
    state.endpoint = url.replace(/\/$/, '');
    state.name = $('#assistantName').value.trim().slice(0, 32) || 'Marko';
    localStorage.setItem(STORE.endpoint, state.endpoint); localStorage.setItem(STORE.name, state.name);
    refreshMode(); renderAllMessages(); renderHistory(); closeSettings(); showToast(state.endpoint ? 'Marko ist eingerichtet. Verbindung über eine Testnachricht prüfen.' : 'Demo-Modus aktiviert.');
  }
  function addNote(title, content) {
    state.notes.unshift({ id: makeId(), title: (title || 'Marko-Notiz').slice(0, 90), content, createdAt: Date.now() });
    state.notes = state.notes.slice(0, 100); writeStore(STORE.notes, state.notes); renderNotes(); showToast('Antwort in deinen Notizen gespeichert.');
  }
  function renderNotes() {
    const grid = $('#notesGrid'); grid.innerHTML = '';
    $('#notesCount').textContent = `${String(state.notes.length).padStart(2, '0')} NOTIZEN`;
    $('#emptyNotes').hidden = state.notes.length > 0;
    state.notes.forEach(note => {
      const card = document.createElement('article'); card.className = 'note-card';
      const title = document.createElement('h3'); title.textContent = note.title;
      const content = document.createElement('p'); content.textContent = note.content;
      const meta = document.createElement('div'); meta.className = 'note-meta';
      const date = new Date(note.createdAt).toLocaleDateString('de-DE');
      meta.innerHTML = `<span>${escapeHTML(date)}</span><button type="button" data-delete-note="${escapeHTML(note.id)}" title="Notiz löschen">Löschen ×</button>`;
      card.append(title, content, meta); grid.appendChild(card);
    });
  }
  function resizeInput() { messageInput.style.height = 'auto'; messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`; }
  function submitNoteDialog() {
    const title = window.prompt('Titel für deine Notiz:', 'Meine Marko-Notiz');
    if (title === null) return;
    const content = window.prompt('Was möchtest du notieren?', '');
    if (content === null || !content.trim()) return;
    addNote(title.trim() || 'Marko-Notiz', content.trim());
  }

  $('#chatForm').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
  messageInput.addEventListener('input', resizeInput);
  messageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
  });
  $('#newChatBtn').addEventListener('click', newChat); $('#brandHome').addEventListener('click', event => { event.preventDefault(); newChat(); });
  $$('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('.prompt-card').forEach(button => button.addEventListener('click', () => { switchView('chat'); messageInput.value = button.dataset.prompt; resizeInput(); messageInput.focus(); }));
  $$('.tool-card').forEach(button => button.addEventListener('click', () => {
    const prompts = {
      brainstorm: 'Sei mein Ideen-Partner. Entwickle 10 kreative Ideen zu diesem Thema und bewerte Aufwand, Nutzen und Originalität. Hilf mir, eine Idee auszuwählen.',
      writing: 'Du bist mein Text-Studio. Hilf mir, einen starken Text zu schreiben. Beginne mit den wichtigsten Rückfragen und liefere anschließend einen hochwertigen Entwurf.',
      coding: 'Du bist mein Senior-Software-Coach. Hilf mir bei einer sauberen, sicheren Lösung. Erkläre Annahmen, gib kommentierten Code und nenne sinnvolle Tests.',
      learning: 'Du bist mein Lern-Coach. Erkläre das Thema Schritt für Schritt, verwende Beispiele, stelle mir danach Quizfragen und passe die Erklärung an mein Niveau an.',
      planning: 'Du bist mein Projekt-Navigator. Verwandle mein Ziel in einen realistischen Plan mit Etappen, Prioritäten, Risiken und konkreten nächsten Schritten.',
      analyze: 'Analysiere meine Frage strukturiert. Trenne Fakten, Annahmen und Unsicherheiten, vergleiche Alternativen und gib eine nachvollziehbare Empfehlung.',
      weather: 'Wie ist das Wetter heute hier? Nutze meinen freigegebenen Browser-Standort und nenne aktuelle Temperatur, Wetterzustand, Wind und Regenwahrscheinlichkeit.',
      research: 'Recherchiere aktuelle Informationen zum HSV (Hamburger SV): Nachrichten, Tabellenposition, nächste Spiele und letzte Ergebnisse. Nutze Websuche und nenne Quellen sowie Datum.'
    };
    switchView('chat'); messageInput.value = prompts[button.dataset.tool] || ''; resizeInput(); messageInput.focus();
  }));
  $('#attachBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    if (file.size > 300_000) { showToast('Bitte eine Textdatei unter 300 KB wählen.'); fileInput.value = ''; return; }
    try {
      const text = await file.text(); state.attachedFile = { name: file.name, text: text.slice(0, 18000) };
      $('#fileName').textContent = `${file.name} · ${file.size.toLocaleString('de-DE')} Byte${text.length > 18000 ? ' · auf 18.000 Zeichen gekürzt' : ''}`;
      $('#fileContext').hidden = false; showToast('Datei ist bereit und wird mit deiner nächsten Nachricht gesendet.');
    } catch { showToast('Die Datei konnte nicht gelesen werden.'); }
  });
  $('#removeFile').addEventListener('click', () => { state.attachedFile = null; $('#fileContext').hidden = true; fileInput.value = ''; });
  messagesEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const message = state.messages[Number(button.dataset.index)]; if (!message || message.role !== 'assistant') return;
    if (button.dataset.action === 'copy') {
      const text = message.content;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('Antwort kopiert.')).catch(() => showToast('Kopieren wurde vom Browser blockiert.'));
      else { const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); showToast('Antwort kopiert.'); }
    } else if (button.dataset.action === 'note') {
      const title = message.content.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 80) || 'Marko-Antwort'; addNote(title, message.content);
    }
  });
  $('#settingsBtn').addEventListener('click', openSettings); $('#topSettings').addEventListener('click', openSettings); $('#setupBackendBtn').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', event => { if (event.target === $('#settingsModal')) closeSettings(); });
  $('#saveSettingsBtn').addEventListener('click', saveSettings); $('#testBackendBtn').addEventListener('click', testBackend);
  $('#clearHistory').addEventListener('click', () => { if (!state.chats.length) return showToast('Der Chat-Verlauf ist bereits leer.'); if (confirm('Alle gespeicherten Unterhaltungen in diesem Browser löschen?')) { state.chats = []; writeStore(STORE.chats, []); newChat(); showToast('Chat-Verlauf gelöscht.'); } });
  $('#newNoteBtn').addEventListener('click', submitNoteDialog);
  $('#notesGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-note]'); if (!button) return;
    state.notes = state.notes.filter(note => note.id !== button.dataset.deleteNote); writeStore(STORE.notes, state.notes); renderNotes(); showToast('Notiz gelöscht.');
  });
  $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newChat(); }
    if (event.key === 'Escape') { closeSettings(); $('#sidebar').classList.remove('open'); }
  });

  // Initial render
  refreshMode(); renderHistory(); renderNotes(); renderAllMessages();
})();
