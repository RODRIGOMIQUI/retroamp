'use strict';

/* =========================================================================
   Letra da música, sincronizada quando possível.
   Ordem de busca: arquivo .lrc com o mesmo nome do MP3 → letra na tag ID3
   (USLT) → cache local (letras já baixadas) → LRCLIB (lrclib.net, base aberta
   de letras sincronizadas) → lyrics.ovh (só texto, reserva quando o LRCLIB
   está fora do ar ou não tem a música).
   GRAVAR coloca a letra baixada dentro do MP3 (ID3 USLT) via window.RetroTags.
   Usa globais de player.js: $, settings, saveSettings, audio, loadedTrack, flashMessage,
   currentTrack, stopped.
   ========================================================================= */

(() => {
  const win = $('#ly-win');
  const btn = $('#btn-ly');
  const linesEl = $('#ly-lines');
  const statusEl = $('#ly-status');
  const offsetEl = $('#ly-offset');
  const otherBtn = $('#ly-other');
  const saveBtn = $('#ly-save');

  let shownTrack = null;
  let shown = null;        // letra exibida: { lines, synced, source, match, candidates, pick }
  let lineEls = [];
  let activeIdx = -1;
  let userScrollUntil = 0;

  /* ---------- Janela ---------- */

  const syncWindow = () => {
    win.hidden = !settings.showLyrics;
    btn.classList.toggle('on', !!settings.showLyrics);
  };
  btn.addEventListener('click', () => {
    settings.showLyrics = !settings.showLyrics;
    syncWindow();
    saveSettings();
  });
  syncWindow();

  /* ---------- Leitura de letras ---------- */

  function parseLrc(text) {
    const out = [];
    let offset = 0;
    for (const raw of text.split(/\r?\n/)) {
      const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
      if (off) { offset = Number(off[1]) / 1000; continue; }
      const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      if (!stamps.length) continue;
      const line = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of stamps) out.push({ time: Number(m[1]) * 60 + parseFloat(m[2].replace(':', '.')), text: line });
    }
    // No padrão LRC, offset positivo faz a letra aparecer mais cedo
    for (const l of out) l.time = Math.max(0, l.time - offset);
    return out.sort((a, b) => a.time - b.time);
  }

  function fromText(text, source) {
    if (!text || !text.trim()) return null;
    const timed = parseLrc(text);
    if (timed.length >= 3) return { lines: timed, synced: true, source };
    return {
      lines: text.trim().split(/\r?\n/).map((l) => ({ time: null, text: l.trim() })),
      synced: false,
      source,
    };
  }

  function artistAndTitle(t) {
    if (t.tags?.title) return { artist: t.tags.artist || '', title: t.tags.title };
    const parts = t.title.split(' - ');
    return parts.length >= 2
      ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
      : { artist: '', title: t.title };
  }

  // Tira número de faixa e marcações como "(Live)", "[Remastered 2011]"
  const cleanTitle = (s) => s
    .replace(/^\s*\d{1,3}[\s.\-_]+/, '')
    .replace(/\s*[([][^)\]]*(live|ao vivo|remaster|version|versão|mix|edit|demo|mono|stereo)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(live|ao vivo|remaster(ed)?)\b.*$/i, '')
    .trim();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // O LRCLIB responde 503 ("server is busy") quando está sobrecarregado, mas costuma voltar
  // em segundos: tenta até 3 vezes, esperando um pouco mais a cada vez
  async function fetchJson(url, service, attempts = 3) {
    let failure;
    for (let i = 0; i < attempts; i++) {
      if (i) await sleep(1200 * i);
      let res;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      } catch (err) {
        failure = new Error(err.name === 'TimeoutError' ? `${service} sem resposta` : `sem conexão com o ${service}`);
        continue;
      }
      if (res.ok || res.status === 404) return { status: res.status, data: await res.json().catch(() => null) };
      failure = new Error(res.status === 503 || res.status === 429 ? `${service} sobrecarregado (HTTP ${res.status})`
        : `${service} respondeu ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    }
    throw failure;
  }

  async function searchLrclib(t) {
    const { artist, title } = artistAndTitle(t);
    const name = cleanTitle(title);
    if (!name) return [];
    const params = new URLSearchParams({ track_name: name });
    if (artist) params.set('artist_name', artist);
    let found;
    try {
      found = (await fetchJson(`https://lrclib.net/api/search?${params}`, 'LRCLIB')).data || [];
    } catch (err) {
      // Busca livre ("q") é outra rota do servidor e às vezes passa quando a outra está ocupada
      found = (await fetchJson(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${name}`.trim() })}`, 'LRCLIB', 2)
        .catch(() => { throw err; })).data || [];
    }
    const list = found.filter((x) => x.instrumental || x.syncedLyrics || x.plainLyrics);
    // Prefere letra sincronizada e duração parecida com a do arquivo
    const dur = t.duration;
    const score = (x) => (Number.isFinite(dur) ? Math.abs(x.duration - dur) : 0)
      + (x.syncedLyrics ? 0 : 20) + (x.instrumental ? 60 : 0);
    return list.sort((a, b) => score(a) - score(b));
  }

  function fromCandidate(candidates, pick) {
    const c = candidates[pick];
    const match = `${c.artistName} - ${c.trackName}`;
    if (c.instrumental) return { lines: [], synced: false, instrumental: true, source: 'LRCLIB', match, candidates, pick };
    const ly = fromText(c.syncedLyrics || c.plainLyrics, 'LRCLIB');
    return ly && { ...ly, match, candidates, pick };
  }

  // Reserva: lyrics.ovh (só texto, sem sincronia; precisa do artista)
  async function searchLyricsOvh(t) {
    const { artist, title } = artistAndTitle(t);
    const name = cleanTitle(title);
    if (!artist || !name) return null;
    const { data } = await fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(name)}`, 'lyrics.ovh', 2);
    const ly = fromText(data?.lyrics?.replace(/^Paroles de la chanson .*\r?\n/, ''), 'LYRICS.OVH');
    return ly && { ...ly, match: `${artist} - ${name}` };
  }

  /* ---------- Cache local ----------
     Letras baixadas ficam guardadas no navegador/app: depois de achada uma vez,
     a letra aparece mesmo com o LRCLIB fora do ar ou sem internet. */

  const CACHE_KEY = 'retroamp-lyrics';
  const CACHE_MAX = 400;

  function cacheKey(t) {
    const { artist, title } = artistAndTitle(t);
    return `${artist}|${cleanTitle(title)}`.toLowerCase();
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
  }

  const ONLINE_SOURCES = ['LRCLIB', 'LYRICS.OVH'];

  // Letra de volta em texto: LRC ([mm:ss.cc]linha) quando sincronizada, somando o ajuste de sincronia
  function toText(ly, offset = 0) {
    if (ly.instrumental) return '';
    if (!ly.synced) return ly.lines.map((l) => l.text).join('\n');
    return ly.lines.map((l) => {
      const time = Math.max(0, l.time + offset);
      return `[${String(Math.floor(time / 60)).padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}]${l.text}`;
    }).join('\n');
  }

  function saveToCache(t, ly) {
    if (!ONLINE_SOURCES.includes(ly.source)) return;
    const cache = readCache();
    const text = toText(ly);
    cache[cacheKey(t)] = { source: ly.source, match: ly.match, text, instrumental: !!ly.instrumental, pick: ly.pick || 0, at: Date.now() };
    // Passou do limite: descarta as mais antigas
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - CACHE_MAX).forEach((k) => delete cache[k]);
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* sem espaço: segue sem cache */ }
  }

  function fromCache(t) {
    const c = readCache()[cacheKey(t)];
    if (!c) return null;
    const base = { source: c.source, match: c.match, cached: true, pick: c.pick };
    if (c.instrumental) return { ...base, lines: [], synced: false, instrumental: true };
    const ly = fromText(c.text, c.source);
    return ly && { ...ly, ...base };
  }

  async function loadLyrics(t) {
    if (t.lrcFile) {
      const ly = fromText(await t.lrcFile.text(), 'ARQUIVO .LRC');
      if (ly) return ly;
    }
    if (t.tags?.lyrics) {
      const ly = fromText(t.tags.lyrics, 'TAG ID3');
      if (ly) return ly;
    }
    // Guardada e sincronizada: pronto. Guardada sem sincronia (ex.: veio do lyrics.ovh
    // quando o LRCLIB estava fora do ar): tenta de novo a sincronizada e só usa a guardada se não houver
    const cached = fromCache(t);
    if (cached && (cached.synced || cached.instrumental)) return cached;

    let ly = null;
    let failure = null;
    try {
      const candidates = await searchLrclib(t);
      if (candidates.length) ly = fromCandidate(candidates, 0);
    } catch (err) {
      failure = err;
    }
    if (cached && !ly?.synced) return cached;
    if (!ly) {
      try {
        ly = await searchLyricsOvh(t);
      } catch { /* a reserva também falhou: vale o erro do LRCLIB */ }
    }
    if (!ly && failure) throw failure;
    if (ly) saveToCache(t, ly);
    return ly;
  }

  /* ---------- Trocar por letra sincronizada quando o LRCLIB voltar ----------
     Com o LRCLIB fora do ar a letra vem sem sincronia (lyrics.ovh). Enquanto a faixa
     estiver na tela, tenta de novo depois de 20 s, 1 min e 3 min; achando, troca sozinho. */

  const UPGRADE_DELAYS = [20000, 60000, 180000];
  let upgradeTimer = null;

  function scheduleUpgrade(t, attempt = 0) {
    clearTimeout(upgradeTimer);
    if (attempt >= UPGRADE_DELAYS.length) return;
    upgradeTimer = setTimeout(async () => {
      if (shownTrack !== t || shown?.synced) return;
      let candidates;
      try {
        candidates = await searchLrclib(t);
      } catch {
        scheduleUpgrade(t, attempt + 1);
        return;
      }
      const i = candidates.findIndex((c) => c.syncedLyrics);
      if (i < 0 || shownTrack !== t || shown?.synced) return;
      const ly = fromCandidate(candidates, i);
      saveToCache(t, ly);
      t.lyricsPromise = Promise.resolve(ly);
      showLyrics(t, ly);
      flashMessage('LETRA SINCRONIZADA ENCONTRADA', 1600);
    }, UPGRADE_DELAYS[attempt]);
  }

  /* ---------- Exibição ---------- */

  function setStatus(html) {
    statusEl.innerHTML = '';
    statusEl.append(...html);
    statusEl.title = statusEl.textContent;
  }

  const bold = (text) => Object.assign(document.createElement('b'), { textContent: text });

  function showMessage(text) {
    shown = null;
    lineEls = [];
    activeIdx = -1;
    linesEl.className = 'ly-lines message';
    linesEl.textContent = text;
    otherBtn.hidden = true;
    saveBtn.hidden = true;
  }

  function showLyrics(t, ly) {
    shown = ly;
    activeIdx = -1;
    linesEl.scrollTop = 0;
    // Sem sincronia, OUTRA procura no LRCLIB uma versão sincronizada
    otherBtn.hidden = !(ly.cached || (ly.candidates && ly.candidates.length > 1) || (!ly.synced && !ly.instrumental));
    // Só letra vinda da internet faz sentido gravar (a do .lrc ou da tag já está no disco)
    saveBtn.hidden = !(ONLINE_SOURCES.includes(ly.source) && !ly.instrumental && /\.mp3$/i.test(t.file.name));

    const status = [bold(ly.source)];
    if (ly.cached) status.push(' (guardada)');
    if (ly.match) status.push(` · ${ly.match}`);
    status.push(ly.synced ? ' · sincronizada' : ' · sem sincronia');
    if (ly.candidates?.length > 1) status.push(` · ${ly.pick + 1}/${ly.candidates.length}`);
    setStatus(status);

    if (ly.instrumental) { showMessage('♪ Instrumental ♪'); shown = ly; return; }
    if (!ly.synced && ONLINE_SOURCES.includes(ly.source)) scheduleUpgrade(t);

    linesEl.className = `ly-lines${ly.synced ? '' : ' plain'}`;
    lineEls = ly.lines.map((l) => {
      const div = document.createElement('div');
      div.className = 'ly-line';
      div.textContent = l.text || (ly.synced ? '♪' : ' ');
      if (ly.synced) {
        div.title = 'Ir para este trecho';
        div.addEventListener('click', () => {
          if (shownTrack !== loadedTrack) return;
          audio.currentTime = Math.max(0, l.time + (t.lyricsOffset || 0));
          userScrollUntil = 0;
        });
      }
      return div;
    });
    linesEl.replaceChildren(...lineEls);
  }

  async function showTrack(t) {
    shownTrack = t;
    updateOffsetLabel();
    if (!t) {
      setStatus(['Nenhuma faixa tocando.']);
      showMessage('A letra aparece aqui quando uma música toca.');
      return;
    }
    setStatus(['Procurando letra…']);
    showMessage('Procurando letra…');
    t.lyricsPromise ||= loadLyrics(t).catch((err) => ({ error: err.message || String(err) }));
    const ly = await t.lyricsPromise;
    if (shownTrack !== t) return;
    if (!ly) {
      setStatus(['Sem letra para ', bold(t.title)]);
      showMessage('Letra não encontrada.\nDica: coloque um arquivo .lrc com o mesmo nome do MP3 na pasta.');
    } else if (ly.error) {
      t.lyricsPromise = null; // tenta de novo na próxima vez
      setStatus(['Falha ao buscar a letra: ', ly.error]);
      showMessage('Não foi possível buscar a letra agora.\nClique aqui para tentar de novo.');
      linesEl.addEventListener('click', () => { if (shownTrack === t && !shown) showTrack(t); }, { once: true });
    } else {
      showLyrics(t, ly);
    }
  }

  otherBtn.addEventListener('click', async () => {
    const t = shownTrack;
    if (!t || !shown) return;
    let { candidates } = shown;
    // Letra guardada no cache: busca de novo no LRCLIB para oferecer a próxima opção
    if (!candidates) {
      otherBtn.disabled = true;
      setStatus(['Procurando outra letra…']);
      try {
        candidates = await searchLrclib(t);
      } catch (err) {
        if (shownTrack === t) showLyrics(t, shown);
        setStatus(['Falha ao buscar outra letra: ', err.message]);
        return;
      } finally {
        otherBtn.disabled = false;
      }
      if (shownTrack !== t) return;
      if (!candidates.length) { setStatus(['O LRCLIB não tem outra letra para ', bold(t.title)]); return; }
    }
    const pick = ((shown.candidates ? shown.pick : shown.cached && shown.source === 'LRCLIB' ? shown.pick : -1) + 1) % candidates.length;
    const ly = fromCandidate(candidates, pick);
    if (!ly) return;
    saveToCache(t, ly);
    t.lyricsPromise = Promise.resolve(ly);
    showLyrics(t, ly);
  });

  saveBtn.addEventListener('click', async () => {
    const t = shownTrack;
    const ly = shown;
    if (!t || !ly) return;
    saveBtn.disabled = true;
    try {
      const onDisk = await RetroTags.writeTrack(t, { lyrics: toText(ly, t.lyricsOffset || 0) });
      // O ajuste já foi aplicado aos tempos gravados
      t.lyricsOffset = 0;
      updateOffsetLabel();
      flashMessage(onDisk ? 'LETRA GRAVADA NO MP3' : 'LETRA NA CÓPIA BAIXADA', 1600);
      // Recarrega: agora a letra vem da tag ID3
      if (shownTrack === t) showTrack(t);
    } catch (err) {
      console.warn('Falha ao gravar a letra', err);
      setStatus(['Não deu para gravar a letra: ', err.message]);
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---------- Ajuste de sincronia ---------- */

  function updateOffsetLabel() {
    const off = shownTrack?.lyricsOffset || 0;
    offsetEl.textContent = `${off > 0 ? '+' : off < 0 ? '−' : '±'}${Math.abs(off).toFixed(1).replace('.', ',')}s`;
  }

  function nudge(delta) {
    if (!shownTrack) return;
    shownTrack.lyricsOffset = Math.round(((shownTrack.lyricsOffset || 0) + delta) * 10) / 10;
    updateOffsetLabel();
    userScrollUntil = 0;
  }
  $('#ly-earlier').addEventListener('click', () => nudge(-0.5));
  $('#ly-later').addEventListener('click', () => nudge(0.5));

  /* ---------- Acompanhamento da música ---------- */

  // Se o usuário rolar a letra com o mouse, a rolagem automática espera um pouco
  linesEl.addEventListener('wheel', () => { userScrollUntil = performance.now() + 4000; }, { passive: true });

  function follow() {
    if (!shown?.synced || !lineEls.length || shownTrack !== loadedTrack || stopped) {
      if (activeIdx !== -1 && stopped) { lineEls[activeIdx]?.classList.remove('active'); activeIdx = -1; }
      return;
    }
    const now = audio.currentTime - (shownTrack.lyricsOffset || 0);
    const lines = shown.lines;
    let idx = -1;
    for (let i = 0; i < lines.length && lines[i].time <= now; i++) idx = i;
    if (idx === activeIdx) return;
    activeIdx = idx;
    lineEls.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('past', i < idx);
    });
    if (idx >= 0 && performance.now() > userScrollUntil) {
      const el = lineEls[idx];
      linesEl.scrollTo({ top: el.offsetTop - linesEl.offsetTop - linesEl.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!settings.showLyrics) return;
    const t = loadedTrack || currentTrack;
    // Espera as tags da faixa serem lidas (podem conter a letra ou o artista certo)
    if (t !== shownTrack && (!t || t.tags)) showTrack(t);
    follow();
  }

  showTrack(null);
  requestAnimationFrame(tick);
})();
