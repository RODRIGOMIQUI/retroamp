'use strict';

/* Várias playlists com nome, salvas entre sessões, e importação/exportação M3U.
   A variável global `playlist` é sempre a lista da playlist ativa.
   Usa globais de player.js: $, playlist, currentTrack, selected, lastClickedId, history,
   search, nextId, loadSeq, knownFiles, fileKey, canLoad, attachFile, readTracksInfo,
   ensureTrackFile, loadTrack, unload, stopped, audio, renderPlaylist, updateRow,
   updateNowPlaying, removeTracks, flashMessage, AUDIO_EXT, M3U_EXT. */

(() => {
  const KEY = 'retroamp-playlists';
  const DEFAULT_NAME = 'Principal';
  const NEW_LIST = 'new';

  const selectEl = $('#pl-select');
  const sendEl = $('#pl-send');
  const rowEl = $('#pl-lists');
  const nameForm = $('#pl-name-form');
  const nameInput = $('#pl-name');
  const importInput = $('#pl-import-input');

  let lists = [];
  let active = null;
  let saveTimer = null;
  let onName = null;

  /* ---------- Faixas <-> dados salvos ---------- */

  const toEntry = (t) => ({
    name: t.file.name,
    size: t.file.size,
    path: t.path || '',
    title: t.title,
    duration: Number.isFinite(t.duration) ? t.duration : null,
  });

  const fromEntry = (e) => ({
    id: nextId++,
    file: { name: e.name, size: e.size || 0 },
    path: e.path || '',
    url: '',
    title: e.title || e.name.replace(/\.[^.]+$/, ''),
    duration: e.duration ?? NaN,
    khz: null,
    mono: false,
    error: false,
    tags: null,
    lrcFile: null,
  });

  const makeList = (name, entries = [], currentIndex = 0) => {
    const tracks = entries.map(fromEntry);
    return { name, tracks, current: tracks[currentIndex] || tracks[0] || null };
  };

  function uniqueName(name, except = null) {
    const taken = new Set(lists.filter((l) => l !== except).map((l) => l.name.toLowerCase()));
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
    return candidate;
  }

  /* ---------- Salvar e carregar ---------- */

  function syncActive() {
    active.tracks = playlist;
    active.current = currentTrack;
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    syncActive();
    const data = {
      active: lists.indexOf(active),
      lists: lists.map((l) => ({
        name: l.name,
        current: Math.max(0, l.tracks.indexOf(l.current)),
        entries: l.tracks.map(toEntry),
      })),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Falha ao salvar as playlists', err);
      flashMessage('SEM ESPAÇO PARA SALVAR AS PLAYLISTS', 2500);
    }
  }

  function persistSoon() {
    saveTimer ??= setTimeout(persist, 300);
  }

  function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch { /* dados corrompidos: começa do zero */ }
    const saved = Array.isArray(data?.lists) ? data.lists : [];
    lists = saved
      .filter((l) => typeof l?.name === 'string' && Array.isArray(l.entries))
      .map((l) => makeList(l.name, l.entries.filter((e) => typeof e?.name === 'string'), l.current));
    if (!lists.length) lists = [makeList(DEFAULT_NAME)];
    active = lists[data?.active] || lists[0];
  }

  /* ---------- Trocar de playlist ---------- */

  const isPlaying = () => !!loadedTrack && !stopped && !audio.paused;

  function syncMenus() {
    selectEl.replaceChildren(...lists.map((l, i) => new Option(l.name, i)));
    selectEl.value = lists.indexOf(active);
    sendEl.replaceChildren(
      new Option('COPIAR…', ''),
      ...lists.map((l, i) => (l === active ? null : new Option(l.name, i))).filter(Boolean),
      new Option('Nova playlist…', NEW_LIST),
    );
  }

  // Religa o que já foi aberto nesta sessão e, no desktop, lê a faixa da vez para mostrar capa e kHz
  function prepareList() {
    const relinked = [];
    for (const t of playlist) {
      if (canLoad(t)) continue;
      const file = knownFiles.get(fileKey(t.file));
      if (file) { attachFile(t, file); relinked.push(t); }
    }
    if (relinked.length) renderPlaylist();
    readTracksInfo(relinked);

    const missing = playlist.filter((t) => !canLoad(t)).length;
    if (missing) flashMessage(`${missing} FAIXA${missing > 1 ? 'S' : ''} SEM ARQUIVO: USE + ARQ OU + PASTA`, 3500);

    const t = currentTrack;
    if (t && !t.url && canLoad(t)) {
      ensureTrackFile(t).then((ok) => {
        if (!ok) t.error = true;
        updateRow(t);
        if (t === currentTrack) updateNowPlaying();
      });
    }
  }

  function show(list, autoplay) {
    syncActive();
    loadSeq++;
    unload();
    active = list;
    playlist = list.tracks;
    currentTrack = list.current && playlist.includes(list.current) ? list.current : playlist[0] || null;
    selected.clear();
    lastClickedId = null;
    history.length = 0;
    search.value = '';
    syncMenus();
    renderPlaylist();
    updateNowPlaying();
    prepareList();
    if (autoplay && currentTrack) loadTrack(currentTrack, true, false);
    persistSoon();
  }

  /* ---------- Nome (o Electron não tem prompt()) ---------- */

  function askName(initial, done) {
    onName = done;
    rowEl.hidden = true;
    nameForm.hidden = false;
    nameInput.value = initial;
    nameInput.focus();
    nameInput.select();
  }

  function closeNameForm() {
    onName = null;
    nameForm.hidden = true;
    rowEl.hidden = false;
    syncMenus();
  }

  /* ---------- Ações ---------- */

  function createList(name, entries = []) {
    const list = makeList(uniqueName(name), entries);
    lists.push(list);
    return list;
  }

  function deleteActive() {
    const n = playlist.length;
    const ask = `Apagar a playlist "${active.name}"${n ? ` e suas ${n} faixa${n === 1 ? '' : 's'}` : ''}? Os arquivos de música não são apagados.`;
    if (n && !confirm(ask)) return;
    if (lists.length === 1) {
      removeTracks([...playlist]);
      active.name = DEFAULT_NAME;
      syncMenus();
      persistSoon();
      return;
    }
    const wasPlaying = isPlaying();
    const i = lists.indexOf(active);
    const replacement = lists[i + 1] || lists[i - 1];
    lists.splice(i, 1);
    removeTracks([...playlist]);
    show(replacement, wasPlaying);
  }

  // Cópia independente: remover da origem não pode invalidar a url usada no destino
  function copyTrack(t) {
    const copy = fromEntry(toEntry(t));
    if (t.url) {
      attachFile(copy, t.file);
      Object.assign(copy, { tags: t.tags, khz: t.khz, mono: t.mono, path: t.path, lrcFile: t.lrcFile });
    }
    return copy;
  }

  function copySelected(target) {
    const chosen = playlist.filter((t) => selected.has(t.id));
    const have = new Set(target.tracks.map((t) => fileKey(t.file)));
    const fresh = chosen.filter((t) => !have.has(fileKey(t.file)));
    target.tracks.push(...fresh.map(copyTrack));
    target.current ||= target.tracks[0] || null;
    const same = chosen.length - fresh.length;
    flashMessage(`+${fresh.length} EM ${target.name.toUpperCase()}${same ? ` · ${same} JÁ ESTAVA${same > 1 ? 'M' : ''}` : ''}`, 1800);
    syncMenus();
    persistSoon();
  }

  /* ---------- M3U ---------- */

  const decodeText = (buf) => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('windows-1252').decode(buf);
    }
  };

  function resolvePath(dir, ref) {
    if (/^file:\/\//i.test(ref)) {
      try { return decodeURIComponent(new URL(ref).pathname); } catch { return ''; }
    }
    if (/^(\/|[A-Za-z]:[\\/])/.test(ref)) return ref;
    if (!dir.startsWith('/')) return '';
    const parts = [];
    for (const p of `${dir}/${ref.replace(/\\/g, '/')}`.split('/')) {
      if (p === '..') parts.pop();
      else if (p && p !== '.') parts.push(p);
    }
    return `/${parts.join('/')}`;
  }

  function parseM3u(text, dir) {
    const entries = [];
    let info = null;
    for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const extinf = /^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/i.exec(line);
      if (extinf) {
        info = { duration: +extinf[1] > 0 ? +extinf[1] : null, title: extinf[2].trim() };
        continue;
      }
      if (line.startsWith('#')) continue;
      // Endereços da internet não são arquivos que o player consiga abrir
      if (!/^[a-z][a-z0-9+.-]+:\/\//i.test(line) || /^file:/i.test(line)) {
        const name = decodeURIComponent(line.split(/[\\/]/).pop().replace(/%(?![0-9a-f]{2})/gi, '%25'));
        if (AUDIO_EXT.test(name)) {
          entries.push({
            name,
            size: 0,
            path: dir ? resolvePath(dir, line) : '',
            title: info?.title || '',
            duration: info?.duration ?? null,
          });
        }
      }
      info = null;
    }
    return entries;
  }

  async function importFile(file) {
    const fullPath = window.desktop?.pathFor(file) || '';
    const dir = fullPath.replace(/[\\/][^\\/]*$/, '');
    const entries = parseM3u(decodeText(await file.arrayBuffer()), dir);
    if (!entries.length) { flashMessage('M3U SEM FAIXAS DE ARQUIVO', 2000); return; }
    const wasPlaying = isPlaying();
    show(createList(file.name.replace(M3U_EXT, '')), false);
    playlist.push(...entries.map(fromEntry));
    currentTrack = playlist[0];
    renderPlaylist();
    updateNowPlaying();
    prepareList();
    if (wasPlaying) loadTrack(currentTrack, true, false);
  }

  function exportActive() {
    if (!playlist.length) { flashMessage('PLAYLIST VAZIA', 1400); return; }
    const lines = ['#EXTM3U'];
    for (const t of playlist) {
      lines.push(`#EXTINF:${Number.isFinite(t.duration) ? Math.round(t.duration) : -1},${t.title}`);
      lines.push(t.path || t.file.name);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'audio/x-mpegurl' }));
    a.download = `${active.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'playlist'}.m3u8`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* ---------- Interface ---------- */

  selectEl.addEventListener('change', () => {
    const list = lists[+selectEl.value];
    if (list && list !== active) show(list, isPlaying());
    selectEl.blur();
  });

  $('#pl-new').addEventListener('click', () => {
    askName('', (name) => show(createList(name), false));
  });

  $('#pl-rename').addEventListener('click', () => {
    askName(active.name, (name) => {
      active.name = uniqueName(name, active);
      persistSoon();
    });
  });

  $('#pl-delete').addEventListener('click', deleteActive);
  $('#pl-import').addEventListener('click', () => importInput.click());
  $('#pl-export').addEventListener('click', exportActive);

  importInput.addEventListener('change', () => {
    [...importInput.files].forEach(importFile);
    importInput.value = '';
  });

  sendEl.addEventListener('change', () => {
    const choice = sendEl.value;
    sendEl.value = '';
    sendEl.blur();
    if (!choice) return;
    if (!selected.size) { flashMessage('SELECIONE AS FAIXAS', 1400); return; }
    if (choice === NEW_LIST) askName('', (name) => { copySelected(createList(name)); });
    else copySelected(lists[+choice]);
  });

  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const done = onName;
    closeNameForm();
    done?.(name);
    syncMenus();
  });
  $('#pl-name-cancel').addEventListener('click', closeNameForm);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeNameForm(); }
  });

  document.addEventListener('playlistchange', persistSoon);
  document.addEventListener('trackchange', persistSoon);
  window.addEventListener('pagehide', persist);

  window.RetroPlaylists = { importFile };

  /* ---------- Inicialização ---------- */

  restore();
  playlist = active.tracks;
  currentTrack = active.current;
  syncMenus();
  renderPlaylist();
  updateNowPlaying();
  prepareList();
})();
