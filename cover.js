'use strict';

/* =========================================================================
   Capa do disco da faixa atual.
   Mostra a imagem gravada no MP3 (ID3 APIC). Sem capa (ou com a errada),
   ⇩ BAIXAR procura no Cover Art Archive (MusicBrainz), OUTRA tenta outro
   disco e GRAVAR coloca a capa dentro do MP3.
   Usa globais de player.js: $, settings, saveSettings, currentTrack, coverUrl,
   flashMessage; e window.RetroTags de tags.js.
   ========================================================================= */

(() => {
  const win = $('#cv-win');
  const btn = $('#btn-cv');
  const frame = $('#cv-frame');
  const img = $('#cv-img');
  const emptyEl = $('#cv-empty');
  const statusEl = $('#cv-status');
  const searchBtn = $('#cv-search');
  const otherBtn = $('#cv-other');
  const saveBtn = $('#cv-save');

  let shownTrack = null;
  // Capa baixada e ainda não gravada: { track, cover, url, candidates, index }
  let preview = null;

  /* ---------- Janela ---------- */

  const syncWindow = () => {
    win.hidden = !settings.showCover;
    btn.classList.toggle('on', !!settings.showCover);
  };
  btn.addEventListener('click', () => {
    settings.showCover = !settings.showCover;
    syncWindow();
    saveSettings();
  });
  syncWindow();

  function setStatus(html, error = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle('error', error);
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  function clearPreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    preview = null;
  }

  function render() {
    const t = currentTrack;
    if (t !== shownTrack) {
      clearPreview();
      shownTrack = t;
    }
    const src = preview ? preview.url : coverUrl(t);
    img.hidden = !src;
    if (src && img.src !== src) img.src = src;
    emptyEl.hidden = !!src;
    emptyEl.textContent = t ? 'SEM CAPA' : 'NENHUMA FAIXA';
    frame.classList.toggle('preview', !!preview);
    const isMp3 = !!t && /\.mp3$/i.test(t.file.name);
    searchBtn.hidden = !t;
    searchBtn.disabled = !isMp3;
    otherBtn.hidden = !preview;
    saveBtn.hidden = !preview;
    if (preview) {
      const r = preview.candidates[preview.index];
      setStatus(`<b>${escapeHtml(r.album || r.title || '?')}</b>${r.year ? ` (${r.year})` : ''} · GRAVAR coloca no MP3`);
    } else if (!t) {
      setStatus('');
    } else if (!isMp3) {
      setStatus('Capas só em arquivos MP3.');
    } else {
      setStatus(t.tags?.cover ? 'Capa gravada no arquivo.' : 'Esta faixa não tem capa.');
    }
  }

  /* ---------- Buscar / gravar ---------- */

  // Artista, título e álbum pelas tags; sem tags, pelo nome "Artista - Título"
  function queryFor(t) {
    const tags = t.tags || {};
    let { artist = '', title = '', album = '' } = tags;
    if (!title) {
      const [a, ...rest] = t.title.split(' - ');
      if (rest.length) { artist ||= a; title = rest.join(' - '); } else title = t.title;
    }
    return { artist: artist.trim(), title: title.trim(), album: album.trim() };
  }

  async function search(fromIndex) {
    const t = currentTrack;
    if (!t) return;
    searchBtn.disabled = otherBtn.disabled = true;
    setStatus('Procurando a capa…');
    try {
      let candidates = preview?.candidates;
      if (fromIndex === undefined || !candidates) {
        candidates = await RetroTags.searchForCover(queryFor(t));
        fromIndex = 0;
      }
      const skip = preview ? RetroTags.coverKey(preview.candidates[preview.index]) : null;
      const found = candidates.length ? await RetroTags.findCover(candidates, fromIndex, skip) : null;
      if (t !== currentTrack) return;
      if (!found) {
        clearPreview();
        render();
        setStatus(fromIndex ? 'Não há outra capa para esta faixa.' : 'Nenhuma capa encontrada.', true);
        return;
      }
      clearPreview();
      preview = {
        track: t, cover: found.cover, candidates, index: found.index,
        url: URL.createObjectURL(new Blob([found.cover.data], { type: found.cover.mime })),
      };
      render();
    } catch (err) {
      setStatus(`Erro ao baixar a capa: ${err.name === 'TimeoutError' ? 'sem resposta' : err.message}`, true);
    } finally {
      searchBtn.disabled = otherBtn.disabled = false;
    }
  }

  async function save() {
    if (!preview) return;
    const { track, cover } = preview;
    saveBtn.disabled = true;
    try {
      const onDisk = await RetroTags.writeTrack(track, { cover });
      clearPreview();
      flashMessage(onDisk ? 'CAPA GRAVADA' : 'CAPA BAIXADA (CÓPIA DO MP3)', 1600);
    } catch (err) {
      console.warn('Falha ao gravar a capa', err);
      setStatus(`Não deu para gravar: ${escapeHtml(err.message)}`, true);
      return;
    } finally {
      saveBtn.disabled = false;
    }
    render();
  }

  searchBtn.addEventListener('click', () => search());
  otherBtn.addEventListener('click', () => search(preview.index + 1));
  saveBtn.addEventListener('click', save);

  // Faixa trocou ou as tags terminaram de ser lidas / foram regravadas
  document.addEventListener('trackchange', render);
  render();
})();
