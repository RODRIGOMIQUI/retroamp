'use strict';

/* =========================================================================
   Busca de música liberada (Internet Archive / Jamendo) — só no app desktop.
   Usa globais de player.js: $, settings, saveSettings, addFiles, flashMessage,
   fmtTime, audio, stopped.
   ========================================================================= */

(() => {
  const lib = window.desktop?.library;
  if (!lib) return;

  const SOURCE_LABEL = { archive: 'ARCHIVE', jamendo: 'JAMENDO' };
  const resultsEl = $('#net-results');
  const statusEl = $('#net-status');
  const preview = new Audio();
  let results = [];
  let searchSeq = 0;
  let previewing = null;
  let resumeMain = false;
  let jobSeq = 0;
  // Mesma faixa em buscas diferentes = mesmo objeto, para manter o estado do download
  const known = new Map();

  settings.netSources ||= { archive: true, jamendo: true };

  /* ---------- Janela ---------- */

  const netWin = $('#net-win');
  const netBtn = $('#btn-net');
  const syncWindow = () => {
    netWin.hidden = !settings.showNet;
    netBtn.classList.toggle('on', !!settings.showNet);
  };
  netBtn.addEventListener('click', () => {
    settings.showNet = !settings.showNet;
    syncWindow();
    saveSettings();
    if (settings.showNet) $('#net-song').focus();
  });
  syncWindow();

  for (const source of Object.keys(SOURCE_LABEL)) {
    const btn = $(`#src-${source}`);
    btn.classList.toggle('on', settings.netSources[source]);
    btn.addEventListener('click', () => {
      settings.netSources[source] = !settings.netSources[source];
      btn.classList.toggle('on', settings.netSources[source]);
      saveSettings();
    });
  }

  /* ---------- Configuração (pasta e chave do Jamendo) ---------- */

  let config = {};
  const showConfig = () => {
    $('#net-dir').textContent = config.libraryDir || '';
    $('#net-dir').title = config.libraryDir || '';
    $('#net-jamendo-key').value = config.jamendoClientId || '';
  };
  lib.getConfig().then((c) => { config = c; showConfig(); });

  $('#net-dir-change').addEventListener('click', async () => {
    config.libraryDir = await lib.chooseDir();
    showConfig();
  });
  $('#net-dir-open').addEventListener('click', () => lib.openDir());
  $('#net-key-save').addEventListener('click', async () => {
    config.jamendoClientId = $('#net-jamendo-key').value.trim();
    await lib.setJamendoKey(config.jamendoClientId);
    setStatus(config.jamendoClientId ? 'Chave do Jamendo salva.' : 'Chave do Jamendo removida.');
  });
  $('#net-key-help').addEventListener('click', () => lib.openExternal('https://devportal.jamendo.com/'));

  /* ---------- Busca ---------- */

  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const errorText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.title = text;
    statusEl.classList.toggle('error', isError);
  }

  function relevance(r, song, band) {
    const title = normalize(r.title);
    const artist = normalize(r.artist);
    let score = 0;
    if (song) score += title === song ? 3 : title.includes(song) ? 2 : 0;
    if (band) score += artist === band ? 3 : artist.includes(band) ? 2 : 0;
    return score;
  }

  async function runSearch() {
    const song = $('#net-song').value.trim();
    const band = $('#net-band').value.trim();
    if (!song && !band) { setStatus('Digite a música e/ou a banda.', true); return; }
    const sources = Object.keys(SOURCE_LABEL).filter((s) => settings.netSources[s]);
    if (!sources.length) { setStatus('Ative pelo menos uma fonte.', true); return; }

    const seq = ++searchSeq;
    results = [];
    render('Buscando…');
    setStatus('Buscando…');

    const settled = await Promise.allSettled(sources.map((s) => lib.search(s, song, band)));
    if (seq !== searchSeq) return;

    const errors = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') results.push(...r.value);
      else errors.push(`${SOURCE_LABEL[sources[i]]}: ${errorText(r.reason)}`);
    });
    results = results.map((r) => {
      const prev = known.get(r.key);
      if (prev) return prev;
      known.set(r.key, r);
      return r;
    });
    const ns = normalize(song);
    const nb = normalize(band);
    results.forEach((r, i) => { r.score = relevance(r, ns, nb); r.order = i; });
    results.sort((a, b) => b.score - a.score || a.order - b.order);

    render('Nada encontrado nos acervos liberados.');
    const count = `${results.length} resultado${results.length === 1 ? '' : 's'}`;
    setStatus(errors.length ? `${count} · ${errors.join(' · ')}` : count, errors.length > 0 && !results.length);
  }

  $('#net-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });

  /* ---------- Resultados ---------- */

  function licenseLabel(url) {
    if (!url) return '';
    const m = url.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/i);
    if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
    if (/publicdomain/i.test(url)) return 'DOMÍNIO PÚBLICO';
    return 'LICENÇA';
  }

  function makeRow(r) {
    const li = document.createElement('li');
    li.dataset.key = r.key;
    li.classList.toggle('done', r.state === 'done');
    li.classList.toggle('failed', r.state === 'error');

    const play = document.createElement('button');
    play.className = 'btn net-play';
    play.type = 'button';
    play.textContent = previewing === r ? '■' : '▶';
    play.classList.toggle('on', previewing === r);
    play.title = previewing === r ? 'Parar prévia' : 'Ouvir prévia';
    play.addEventListener('click', () => togglePreview(r));

    const info = document.createElement('div');
    info.className = 'net-info';
    const title = document.createElement('div');
    title.className = 'net-title';
    title.textContent = r.title;
    title.title = r.title;
    const meta = document.createElement('div');
    meta.className = 'net-meta';
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = SOURCE_LABEL[r.source];
    const parts = [r.artist, r.album, Number.isFinite(r.duration) && r.duration > 0 ? fmtTime(r.duration) : '']
      .filter(Boolean).join(' · ');
    meta.append(src, ` ${parts}`);
    const lic = licenseLabel(r.license);
    if (lic) {
      const a = document.createElement('a');
      a.textContent = lic;
      a.title = r.license;
      a.addEventListener('click', () => lib.openExternal(r.license));
      meta.append(' · ', a);
    }
    if (r.page) {
      const a = document.createElement('a');
      a.textContent = 'página';
      a.title = r.page;
      a.addEventListener('click', () => lib.openExternal(r.page));
      meta.append(' · ', a);
    }
    meta.title = `${SOURCE_LABEL[r.source]} ${parts}`;
    info.append(title, meta);

    const dl = document.createElement('button');
    dl.className = 'btn net-dl';
    dl.type = 'button';
    dl.textContent = {
      queued: 'NA FILA',
      downloading: r.progress != null ? `${Math.round(r.progress * 100)}%`
        : r.received ? `${(r.received / 1048576).toFixed(1)} MB` : '…',
      done: '✓ OK',
      error: 'ERRO',
    }[r.state] || '⇩ BAIXAR';
    dl.title = {
      queued: 'Na fila (clique para tirar da fila)',
      downloading: 'Baixando (clique para cancelar)',
      done: `Salvo em ${r.savedPath}`,
      error: `${r.error} (clique para tentar de novo)`,
    }[r.state] || 'Colocar na fila de downloads';
    dl.classList.toggle('queued', r.state === 'queued');
    dl.disabled = r.state === 'done';
    dl.addEventListener('click', () => {
      if (r.state === 'queued') unqueue(r);
      else if (r.state === 'downloading') lib.cancel(r.jobId);
      else enqueue([r]);
    });

    li.append(play, info, dl);
    return li;
  }

  function render(emptyText) {
    if (!results.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyText || 'Digite a música e a banda e clique em BUSCAR.';
      resultsEl.replaceChildren(li);
      return;
    }
    resultsEl.replaceChildren(...results.map(makeRow));
  }

  function updateRow(r) {
    const li = [...resultsEl.children].find((el) => el.dataset.key === r.key);
    if (li) li.replaceWith(makeRow(r));
  }

  /* ---------- Prévia ---------- */

  function stopPreview() {
    const was = previewing;
    previewing = null;
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    if (was) updateRow(was);
    if (resumeMain) { resumeMain = false; audio.play().catch(() => {}); }
  }

  function togglePreview(r) {
    if (previewing === r) { stopPreview(); return; }
    if (previewing) stopPreview();
    if (!audio.paused && !stopped) { resumeMain = true; audio.pause(); }
    previewing = r;
    preview.src = r.stream;
    preview.volume = (settings.volume / 100) ** 2;
    preview.play().catch(() => {
      setStatus('Não foi possível tocar a prévia.', true);
      stopPreview();
    });
    updateRow(r);
  }

  preview.addEventListener('ended', stopPreview);
  // A prévia não passa pelo grafo de áudio do player: acompanha o slider de volume à parte
  $('#volume').addEventListener('input', (e) => { preview.volume = (e.target.value / 100) ** 2; });

  /* ---------- Fila de downloads ---------- */

  const queue = [];
  let active = null;
  let batch = { total: 0, done: 0, failed: 0 };
  const queueBar = $('#net-queue');

  function enqueue(items) {
    const fresh = items.filter((r) => !r.state || r.state === 'error');
    if (!fresh.length) return;
    for (const r of fresh) {
      r.state = 'queued';
      r.error = null;
      queue.push(r);
      updateRow(r);
    }
    batch.total += fresh.length;
    updateQueueBar();
    pump();
  }

  function unqueue(r) {
    const i = queue.indexOf(r);
    if (i < 0) return;
    queue.splice(i, 1);
    r.state = undefined;
    batch.total--;
    updateRow(r);
    updateQueueBar();
  }

  function cancelAll() {
    for (const r of queue.splice(0)) {
      r.state = undefined;
      batch.total--;
      updateRow(r);
    }
    if (active) lib.cancel(active.jobId);
    updateQueueBar();
  }

  async function pump() {
    if (active || !queue.length) return;
    const r = (active = queue.shift());
    r.state = 'downloading';
    r.progress = null;
    r.received = 0;
    r.jobId = `job${++jobSeq}`;
    updateRow(r);
    updateQueueBar();
    try {
      const res = await lib.download({
        jobId: r.jobId, url: r.download, title: r.title, artist: r.artist, album: r.album,
      });
      r.state = 'done';
      r.savedPath = res.path;
      batch.done++;
      addFiles([Object.assign(new File([res.data], res.name, { type: 'audio/mpeg' }), { savedPath: res.path })]);
      flashMessage(`BAIXADO: ${r.title.toUpperCase()}`, 2000);
    } catch (err) {
      r.error = errorText(err);
      if (r.error === 'cancelado') {
        r.state = undefined;
        batch.total--;
      } else {
        r.state = 'error';
        batch.failed++;
      }
    }
    active = null;
    updateRow(r);
    if (queue.length) {
      pump();
    } else {
      finishBatch();
    }
    updateQueueBar();
  }

  function finishBatch() {
    const { done, failed } = batch;
    if (done || failed) {
      const msg = `Fila concluída: ${done} baixada${done === 1 ? '' : 's'}`
        + (failed ? `, ${failed} com erro (passe o mouse em ERRO para ver o motivo)` : '');
      setStatus(msg, failed > 0 && !done);
    }
    batch = { total: 0, done: 0, failed: 0 };
  }

  function updateQueueBar() {
    const busy = !!active || queue.length > 0;
    queueBar.hidden = !busy;
    if (!busy) return;
    const position = Math.min(batch.done + batch.failed + 1, batch.total);
    const current = active ? ` · ${active.title}` : '';
    $('#net-queue-text').textContent = `BAIXANDO ${position} DE ${batch.total}${current}`;
    $('#net-queue-text').title = $('#net-queue-text').textContent;
    const fraction = batch.total
      ? (batch.done + batch.failed + (active?.progress || 0)) / batch.total : 0;
    $('#net-queue-fill').style.width = `${Math.round(fraction * 100)}%`;
  }

  $('#net-queue-cancel').addEventListener('click', cancelAll);

  $('#net-all').addEventListener('click', () => {
    const pending = results.filter((r) => !r.state || r.state === 'error');
    if (!pending.length) { setStatus('Nada novo para baixar nesta busca.'); return; }
    if (pending.length > 10 && !confirm(`Colocar ${pending.length} faixas na fila de downloads?`)) return;
    enqueue(pending);
  });

  lib.onProgress(({ jobId, received, total }) => {
    if (!active || active.jobId !== jobId) return;
    active.progress = total ? received / total : null;
    active.received = received;
    updateRow(active);
    updateQueueBar();
  });

  render();
})();
