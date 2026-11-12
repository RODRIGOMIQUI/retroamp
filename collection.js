'use strict';

/* =========================================================================
   Biblioteca de músicas: todas as músicas que o player conhece, com título,
   artista, álbum e duração, salvas entre sessões. Daqui as músicas vão para a
   playlist (duplo clique toca agora; botões põem no fim ou como próxima;
   também dá para arrastar as linhas para a playlist).
   Usa globais de player.js: $, settings, saveSettings, knownFiles, fileKey,
   readFileInfo, probeDuration, fmtTime, flashMessage, queueEntries, AUDIO_EXT,
   M3U_EXT, trackKey, playlist.
   ========================================================================= */

(() => {
  const KEY = 'retroamp-library';
  const DRAG_TYPE = 'application/x-retroamp-library';
  const NONE = '\u0000'; // grupo "sem artista/álbum/gênero"

  const listEl = $('#lib-list');
  const groupsEl = $('#lib-groups');
  const searchEl = $('#lib-search');
  const groupSel = $('#lib-group');
  const headEl = $('#lib-head');
  const plList = $('#pl-list');

  let items = [];
  const byKey = new Map();
  let nextLibId = 1;
  let selectedIds = new Set();
  let lastClicked = null;
  let filter = null; // valor do grupo escolhido na lista lateral (null = todas)
  let visible = [];
  let saveTimer = null;

  settings.libSort ||= { key: 'artist', dir: 1 };
  settings.libGroup ||= 'artist';
  groupSel.value = settings.libGroup;

  const keyOf = (e) => e.path || `${e.name}|${e.size}`;
  const titleFromName = (name) => name.replace(/\.[^.]+$/, '');
  const fullTitle = (e) => (e.artist ? `${e.artist} - ${e.title}` : e.title);
  const knownFile = (e) => knownFiles.get(`${e.name}|${e.size}`) || knownFiles.get(`${e.name}|0`);
  const available = (e) => !!knownFile(e) || !!(e.path && window.desktop?.readAudio);

  /* ---------- Salvar e carregar ---------- */

  const FIELDS = ['name', 'size', 'path', 'title', 'artist', 'album', 'genre', 'year', 'track', 'duration', 'scanned', 'added'];

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const data = items.map((e) => Object.fromEntries(FIELDS.map((f) => [f, e[f]])));
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Falha ao salvar a biblioteca', err);
      flashMessage('SEM ESPAÇO PARA SALVAR A BIBLIOTECA', 2500);
    }
  }
  const persistSoon = () => { saveTimer ??= setTimeout(persist, 500); };

  // Cria (ou completa) um item. Devolve [item, novo?]
  function upsert(data) {
    const key = keyOf(data);
    const old = byKey.get(key) || (data.path && byKey.get(`${data.name}|${data.size}`));
    if (old) {
      if (!old.path && data.path) { byKey.delete(keyOf(old)); old.path = data.path; byKey.set(keyOf(old), old); }
      if (!old.size && data.size) old.size = data.size;
      if (!Number.isFinite(old.duration) && Number.isFinite(data.duration)) old.duration = data.duration;
      return [old, false];
    }
    const e = {
      id: nextLibId++,
      name: data.name,
      size: data.size || 0,
      path: data.path || '',
      title: data.title || titleFromName(data.name),
      artist: data.artist || '',
      album: data.album || '',
      genre: data.genre || '',
      year: data.year || '',
      track: data.track || 0,
      duration: Number.isFinite(data.duration) ? data.duration : null,
      scanned: !!data.scanned,
      added: data.added || Date.now(),
    };
    items.push(e);
    byKey.set(key, e);
    return [e, true];
  }

  function restore() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch { /* corrompido: começa vazia */ }
    if (Array.isArray(saved)) {
      for (const e of saved) if (typeof e?.name === 'string') upsert(e);
    }
    // Primeira vez (ou faixas que só existiam nas playlists): a biblioteca começa com elas
    let added = 0;
    for (const e of window.RetroPlaylists?.allEntries() || []) {
      // Na playlist o título vem como "Artista - Título": as tags são lidas depois
      if (upsert({ name: e.name, size: e.size, path: e.path, duration: e.duration ?? null })[1]) added++;
    }
    if (added) persistSoon();
  }

  /* ---------- Leitura das tags (em segundo plano, uma música por vez) ---------- */

  function applyInfo(e, info, duration) {
    if (info.title) e.title = info.title;
    e.artist = info.artist || e.artist;
    e.album = info.album || e.album;
    e.genre = (info.genre || e.genre).replace(/^\((\d+)\)$/, '');
    e.year = String(info.year || e.year || '').slice(0, 4);
    e.track = parseInt(info.track, 10) || e.track || 0;
    if (Number.isFinite(duration) && duration > 0) e.duration = duration;
    e.scanned = true;
  }

  let scanning = false;
  let renderTimer = null;
  const renderSoon = () => { renderTimer ??= setTimeout(() => { renderTimer = null; render(); }, 400); };

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      for (;;) {
        const e = items.find((x) => !x.scanned && !x.unreadable && available(x));
        if (!e) break;
        try {
          let file = knownFile(e);
          if (!file) file = new File([await window.desktop.readAudio(e.path)], e.name);
          const url = URL.createObjectURL(file);
          const [info, duration] = await Promise.all([readFileInfo(file), probeDuration(url)]);
          URL.revokeObjectURL(url);
          if (!e.size) e.size = file.size;
          applyInfo(e, info, duration);
        } catch (err) {
          console.warn('Biblioteca: não deu para ler', e.path || e.name, err);
          e.unreadable = true; // só nesta sessão: o arquivo pode voltar
        }
        persistSoon();
        renderSoon();
      }
    } finally {
      scanning = false;
    }
  }

  /* ---------- Adicionar arquivos ---------- */

  // quiet: chamado por addFiles (a playlist já mostra a mensagem)
  function importFiles(files, quiet = false) {
    const audioFiles = [...files].filter((f) => !M3U_EXT.test(f.name)
      && (f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)));
    let added = 0;
    for (const f of audioFiles) {
      knownFiles.set(fileKey(f), f);
      knownFiles.set(`${f.name}|0`, f);
      const path = f.savedPath || window.desktop?.pathFor(f) || '';
      const [e, isNew] = upsert({ name: f.name, size: f.size, path });
      if (isNew) added++;
      delete e.unreadable;
    }
    if (!quiet) {
      if (!audioFiles.length) flashMessage('NENHUM ARQUIVO DE ÁUDIO');
      else {
        const same = audioFiles.length - added;
        flashMessage(`+${added} NA BIBLIOTECA${same ? ` · ${same} JÁ ESTAVA${same > 1 ? 'M' : ''}` : ''}`, 1800);
      }
    }
    render();
    persistSoon();
    scan();
    return added;
  }

  // Tags editadas na playlist (TAG) ou lidas ao tocar atualizam a biblioteca
  let syncTimer = null;
  function syncFromPlaylist() {
    syncTimer = null;
    let changed = false;
    for (const t of playlist) {
      if (!t.tags) continue;
      const e = byKey.get(trackKey(t)) || byKey.get(fileKey(t.file));
      if (!e) continue;
      const before = `${e.title}|${e.artist}|${e.album}|${e.genre}|${e.year}|${e.track}|${e.duration}`;
      applyInfo(e, t.tags, t.duration);
      if (t.file.size && e.size !== t.file.size && !e.path) {
        byKey.delete(keyOf(e)); e.size = t.file.size; byKey.set(keyOf(e), e);
      }
      if (before !== `${e.title}|${e.artist}|${e.album}|${e.genre}|${e.year}|${e.track}|${e.duration}`) changed = true;
    }
    if (changed) { persistSoon(); renderSoon(); }
  }
  document.addEventListener('playlistchange', () => { syncTimer ??= setTimeout(syncFromPlaylist, 600); });
  document.addEventListener('playlistchange', markQueued);

  /* ---------- Desenhar ---------- */

  const groupValue = (e) => e[settings.libGroup] || NONE;
  const NO_GROUP = { artist: '(sem artista)', album: '(sem álbum)', genre: '(sem gênero)' };

  function matches(e, q) {
    return !q || `${e.title} ${e.artist} ${e.album} ${e.genre} ${e.name}`.toLowerCase().includes(q);
  }

  function compare(a, b) {
    const { key, dir } = settings.libSort;
    const text = (x, y) => (x || '￿').localeCompare(y || '￿', undefined, { numeric: true, sensitivity: 'base' });
    let r;
    if (key === 'duration') r = (a.duration ?? Infinity) - (b.duration ?? Infinity);
    else r = text(a[key], b[key]);
    // Desempate: artista, álbum, número da faixa, título
    return r * dir || text(a.artist, b.artist) || text(a.album, b.album)
      || (a.track || 999) - (b.track || 999) || text(a.title, b.title);
  }

  function renderGroups(searched) {
    const counts = new Map();
    for (const e of searched) counts.set(groupValue(e), (counts.get(groupValue(e)) || 0) + 1);
    if (filter != null && !counts.has(filter)) filter = null;
    const names = [...counts.keys()].sort((a, b) => (a === NONE) - (b === NONE)
      || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const row = (value, label, n) => {
      const li = document.createElement('li');
      li.dataset.value = value ?? '';
      li.classList.toggle('selected', filter === value);
      li.classList.toggle('none', value === NONE);
      const name = document.createElement('span');
      name.className = 'lib-group-name';
      name.textContent = label;
      const count = document.createElement('span');
      count.className = 'lib-group-count';
      count.textContent = n;
      li.append(name, count);
      li.title = `${label} (${n})`;
      li.groupValue = value;
      return li;
    };
    groupsEl.replaceChildren(
      row(null, { artist: 'TODOS OS ARTISTAS', album: 'TODOS OS ÁLBUNS', genre: 'TODOS OS GÊNEROS' }[settings.libGroup], searched.length),
      ...names.map((v) => row(v, v === NONE ? NO_GROUP[settings.libGroup] : v, counts.get(v))),
    );
  }

  function makeRow(e) {
    const li = document.createElement('li');
    li.dataset.id = e.id;
    li.draggable = true;
    li.classList.toggle('selected', selectedIds.has(e.id));
    li.classList.toggle('missing', !available(e));
    if (!available(e)) li.title = 'Arquivo não carregado: adicione de novo com + ARQ ou + PASTA';
    const cell = (cls, text) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      return span;
    };
    li.append(
      cell('lib-c-title', e.title),
      cell('lib-c-artist', e.artist),
      cell('lib-c-album', e.album),
      cell('lib-c-dur', Number.isFinite(e.duration) ? fmtTime(e.duration) : ''),
    );
    return li;
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const searched = items.filter((e) => matches(e, q));
    renderGroups(searched);
    visible = searched.filter((e) => filter == null || groupValue(e) === filter).sort(compare);
    const scrollTop = listEl.scrollTop;
    listEl.replaceChildren(...visible.map(makeRow));
    listEl.scrollTop = scrollTop;
    markQueued();
    $('#lib-empty').hidden = items.length > 0;
    const total = visible.reduce((s, e) => s + (Number.isFinite(e.duration) ? e.duration : 0), 0);
    const n = visible.length;
    $('#lib-total').textContent = `${n}${n !== items.length ? `/${items.length}` : ''} música${items.length === 1 ? '' : 's'} · ${fmtTime(total)}`;
    for (const b of headEl.querySelectorAll('button')) {
      const on = b.dataset.sort === settings.libSort.key;
      b.classList.toggle('on', on);
      b.dataset.dir = on ? (settings.libSort.dir > 0 ? '▲' : '▼') : '';
    }
  }

  // Marca na biblioteca as músicas que já estão na playlist ativa
  function markQueued() {
    const inPlaylist = new Set(playlist.map(trackKey));
    for (const t of playlist) inPlaylist.add(fileKey(t.file));
    const byId = new Map(items.map((e) => [e.id, e]));
    for (const li of listEl.children) {
      const e = byId.get(+li.dataset.id);
      li.classList.toggle('queued', !!e && (inPlaylist.has(keyOf(e)) || inPlaylist.has(`${e.name}|${e.size}`)));
    }
  }

  /* ---------- Ações ---------- */

  const chosen = () => visible.filter((e) => selectedIds.has(e.id));
  const toEntry = (e) => ({ name: e.name, size: e.size, path: e.path, title: fullTitle(e), duration: e.duration });

  function send(entries, mode) {
    if (!entries.length) { flashMessage('SELECIONE AS MÚSICAS', 1400); return; }
    const missing = entries.filter((e) => !available(e)).length;
    queueEntries(entries.map(toEntry), mode);
    if (missing && mode !== 'play') flashMessage(`${missing} SEM ARQUIVO: USE + ARQ OU + PASTA`, 2500);
  }

  function removeSelected() {
    const gone = chosen();
    if (!gone.length) return;
    if (gone.length > 1 && !confirm(`Tirar ${gone.length} músicas da biblioteca? Os arquivos continuam no disco e nas playlists.`)) return;
    const ids = new Set(gone.map((e) => e.id));
    items = items.filter((e) => !ids.has(e.id));
    for (const e of gone) byKey.delete(keyOf(e));
    selectedIds.clear();
    render();
    persistSoon();
  }

  /* ---------- Interface ---------- */

  listEl.addEventListener('click', (ev) => {
    const li = ev.target.closest('li');
    if (!li) { selectedIds.clear(); refreshSelection(); return; }
    const id = +li.dataset.id;
    if (ev.shiftKey && lastClicked != null) {
      const ids = visible.map((e) => e.id);
      const [a, b] = [ids.indexOf(lastClicked), ids.indexOf(id)].sort((x, y) => x - y);
      selectedIds = new Set(ids.slice(Math.max(0, a), b + 1));
    } else if (ev.ctrlKey || ev.metaKey) {
      selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
      lastClicked = id;
    } else {
      selectedIds = new Set([id]);
      lastClicked = id;
    }
    refreshSelection();
  });

  function refreshSelection() {
    for (const li of listEl.children) li.classList.toggle('selected', selectedIds.has(+li.dataset.id));
  }

  listEl.addEventListener('dblclick', (ev) => {
    const li = ev.target.closest('li');
    const e = li && items.find((x) => x.id === +li.dataset.id);
    if (e) send([e], 'play');
  });

  listEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); send(chosen(), ev.shiftKey ? 'end' : 'play'); }
    else if (ev.key === 'Delete') { ev.preventDefault(); removeSelected(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      selectedIds = new Set(visible.map((e) => e.id));
      refreshSelection();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      ev.stopPropagation();
      const ids = visible.map((e) => e.id);
      const i = Math.max(-1, ids.indexOf(lastClicked)) + (ev.key === 'ArrowDown' ? 1 : -1);
      const id = ids[Math.min(ids.length - 1, Math.max(0, i))];
      if (id == null) return;
      selectedIds = new Set([id]);
      lastClicked = id;
      refreshSelection();
      listEl.querySelector(`li[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });

  groupsEl.addEventListener('click', (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    filter = li.groupValue ?? null;
    selectedIds.clear();
    render();
    listEl.scrollTop = 0;
  });
  // Duplo clique num artista/álbum: tudo dele vai para a playlist
  groupsEl.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('li')) send(visible, 'end');
  });

  groupSel.addEventListener('change', () => {
    settings.libGroup = groupSel.value;
    filter = null;
    saveSettings();
    render();
    groupSel.blur();
  });

  headEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const s = settings.libSort;
    settings.libSort = s.key === b.dataset.sort ? { key: s.key, dir: -s.dir } : { key: b.dataset.sort, dir: 1 };
    saveSettings();
    render();
  });

  searchEl.addEventListener('input', () => { filter = null; render(); });
  searchEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { searchEl.value = ''; render(); searchEl.blur(); }
    if (ev.key === 'Enter' && visible.length) { ev.preventDefault(); send(visible.slice(0, 1), 'play'); }
  });

  $('#lib-play').addEventListener('click', () => send(chosen(), 'play'));
  $('#lib-next').addEventListener('click', () => send(chosen(), 'next'));
  $('#lib-queue').addEventListener('click', () => send(chosen(), 'end'));
  $('#lib-queue-all').addEventListener('click', () => send(visible, 'end'));
  $('#lib-remove').addEventListener('click', removeSelected);
  $('#lib-add').addEventListener('click', () => $('#lib-file-input').click());
  $('#lib-add-dir').addEventListener('click', () => $('#lib-dir-input').click());
  for (const id of ['#lib-file-input', '#lib-dir-input']) {
    const input = $(id);
    input.addEventListener('change', () => {
      importFiles(input.files);
      input.value = '';
    });
  }

  /* ---------- Arrastar da biblioteca para a playlist ---------- */

  listEl.addEventListener('dragstart', (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    const id = +li.dataset.id;
    if (!selectedIds.has(id)) { selectedIds = new Set([id]); lastClicked = id; refreshSelection(); }
    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify([...selectedIds]));
    const n = selectedIds.size;
    ev.dataTransfer.setData('text/plain', n > 1 ? `${n} músicas` : li.querySelector('.lib-c-title').textContent);
    document.body.classList.add('dragging-library');
  });
  listEl.addEventListener('dragend', () => {
    document.body.classList.remove('dragging-library');
    clearMarks();
  });

  const isLibDrag = (ev) => [...ev.dataTransfer.types].includes(DRAG_TYPE);
  const clearMarks = () => plList.querySelectorAll('.drop-before, .drop-after')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  const plWin = $('#pl-win');

  plWin.addEventListener('dragover', (ev) => {
    if (!isLibDrag(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    clearMarks();
    const li = ev.target.closest('#pl-list li');
    if (li) {
      const r = li.getBoundingClientRect();
      li.classList.add(ev.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  plWin.addEventListener('dragleave', (ev) => { if (!plWin.contains(ev.relatedTarget)) clearMarks(); });
  plWin.addEventListener('drop', (ev) => {
    if (!isLibDrag(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    document.body.classList.remove('dragging-library');
    let ids = [];
    try { ids = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE)); } catch { /* nada */ }
    const set = new Set(ids);
    const entries = visible.filter((e) => set.has(e.id));
    const li = ev.target.closest('#pl-list li');
    const after = li?.classList.contains('drop-after');
    clearMarks();
    if (!entries.length) return;
    const tracks = queueEntries(entries.map(toEntry), 'end');
    // Solto em cima de uma faixa: as novas vão para aquele ponto
    const target = li && playlist.find((t) => t.id === +li.dataset.id);
    if (target && !tracks.includes(target)) {
      const moving = new Set(tracks);
      playlist = playlist.filter((t) => !moving.has(t));
      playlist.splice(playlist.indexOf(target) + (after ? 1 : 0), 0, ...tracks);
      renderPlaylist();
      updateNowPlaying();
    }
  });

  window.RetroLibrary = { importFiles };

  /* ---------- Inicialização ---------- */

  restore();
  render();
  scan();
  window.addEventListener('pagehide', persist);
})();
