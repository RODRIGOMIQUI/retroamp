'use strict';

/* =========================================================================
   Editor de tags ID3 (título, artista, álbum, ano, faixa, gênero e capa).
   - DO NOME preenche a partir do nome do arquivo ("01 - Banda - Música.mp3").
   - BUSCAR procura a gravação no MusicBrainz e preenche álbum, ano, faixa...
   - CAPA: BAIXAR traz a capa do Cover Art Archive; ARQUIVO usa uma imagem local.
   - SALVAR grava no próprio MP3 (app desktop) ou baixa uma cópia (navegador).
   Expõe window.RetroTags (busca de capa e gravação) para a janela da capa.
   Com várias faixas selecionadas, edita só os campos em comum.
   Mantém os outros quadros da tag (letra, capa, comentários).
   Usa globais de player.js: $, playlist, selected, currentTrack, list,
   readFileInfo, trackTitle, releaseCover, coverUrl, updateRow, updateNowPlaying,
   flashMessage.
   ========================================================================= */

(() => {
  const win = $('#tag-win');
  const form = $('#tag-form');
  const statusEl = $('#tag-status');
  const resultsEl = $('#tag-results');
  const lookupBtn = $('#tag-lookup');
  const FIELDS = ['title', 'artist', 'album', 'year', 'track', 'genre'];
  const PER_FILE = ['title', 'track']; // não fazem sentido iguais em várias faixas
  const input = (k) => form.elements[k];

  let editing = [];     // faixas abertas no editor
  let initial = {};     // valores ao abrir ('' quando diferem entre as faixas)
  let mixed = new Set();
  let fromNames = false; // várias faixas: título/artista/faixa vêm do nome de cada arquivo
  let dirty = false;
  let lookupResults = [];
  let pendingCover;      // undefined: capa fica como está · null: remover · { mime, data }: nova
  let coverFollowsResult = false; // depois de BAIXAR, trocar de resultado troca a capa também
  let thumbUrl = '';

  /* ---------- Escrita da tag ID3v2 ---------- */

  const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const isId3 = (b) => b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;

  // Quadros da v2.2 (ids de 3 letras) com o mesmo conteúdo na v2.3; o resto é descartado
  const V22_TO_V23 = {
    TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TYE: 'TYER', TRK: 'TRCK', TCO: 'TCON',
    TCM: 'TCOM', TPA: 'TPOS', ULT: 'USLT', COM: 'COMM',
  };

  // Lê a tag existente: versão, quadros crus e onde começa o áudio
  function parseTag(bytes) {
    if (!isId3(bytes)) return { ver: 0, frames: [], audioStart: 0 };
    const ver = bytes[3];
    const flags = bytes[5];
    const size = syncsafe(bytes, 6);
    const audioStart = 10 + size + (ver === 4 && flags & 0x10 ? 10 : 0);
    let body = bytes.subarray(10, 10 + size);
    // Dessincronização da tag inteira (v2.2/v2.3): FF 00 volta a ser FF
    if (ver < 4 && flags & 0x80) {
      const out = [];
      for (let i = 0; i < body.length; i++) {
        out.push(body[i]);
        if (body[i] === 0xff && body[i + 1] === 0) i++;
      }
      body = Uint8Array.from(out);
    }
    const idLen = ver === 2 ? 3 : 4;
    const hdrLen = ver === 2 ? 6 : 10;
    let pos = 0;
    if (ver >= 3 && flags & 0x40) pos = ver === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;

    const frames = [];
    while (pos + hdrLen <= body.length) {
      let id = String.fromCharCode(...body.subarray(pos, pos + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const fsize = ver === 2 ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5]
        : ver === 4 ? syncsafe(body, pos + 4) : u32(body, pos + 4);
      const fflags = ver === 2 ? [0, 0] : [body[pos + 8], body[pos + 9]];
      const data = body.subarray(pos + hdrLen, pos + hdrLen + fsize);
      pos += hdrLen + fsize;
      if (ver === 2 && id === 'PIC') {
        // PIC tem o formato em 3 letras no lugar do MIME
        const mime = /png/i.test(String.fromCharCode(...data.subarray(1, 4))) ? 'image/png' : 'image/jpeg';
        frames.push({ id: 'APIC', flags: fflags, data: concatBytes([data[0]], latin1(mime), [0], data.subarray(4)) });
        continue;
      }
      if (ver === 2) {
        id = V22_TO_V23[id];
        if (!id) continue;
      }
      frames.push({ id, flags: fflags, data });
    }
    return { ver, frames, audioStart };
  }

  function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // Tipo da imagem num quadro APIC (3 = capa frontal)
  function apicType(d) {
    let i = 1;
    while (i < d.length && d[i]) i++;
    return d[i + 1];
  }

  // USLT: codificação + idioma ("XXX" = não informado) + descrição vazia + letra.
  // Em UTF-16 cada texto leva o próprio BOM e a descrição termina em 00 00.
  function usltFrame(ver, text) {
    let body;
    if (ver === 4) body = concatBytes([3], latin1('XXX'), [0], new TextEncoder().encode(text));
    else if (fitsLatin1(text)) body = concatBytes([0], latin1('XXX'), [0], latin1(text));
    else body = concatBytes([1], latin1('XXX'), [0xff, 0xfe, 0, 0], encodeText(3, text).subarray(1));
    return { id: 'USLT', flags: [0, 0], data: body };
  }

  // TXXX "LYRICS" / "UNSYNCEDLYRICS" / "USLT" (gravados pelo ffmpeg e outros) também é letra
  const isLyricsTxxx = (f) => f.id === 'TXXX'
    && /lyrics|uslt/i.test(String.fromCharCode(...f.data.subarray(1, 64)).replace(/\0/g, ''));

  // APIC: Latin-1, MIME, tipo 3 (capa frontal), descrição vazia, imagem
  const apicFrame = ({ mime, data }) => ({ id: 'APIC', flags: [0, 0], data: concatBytes([0], latin1(mime), [0, 3, 0], data) });

  const fitsLatin1 = (s) => [...s].every((c) => c.codePointAt(0) <= 0xff);
  const latin1 = (s) => Uint8Array.from([...s], (c) => (c.codePointAt(0) <= 0xff ? c.codePointAt(0) : 0x3f));

  // v2.4 grava em UTF-8; v2.3 em Latin-1 quando dá, senão UTF-16 com BOM
  function encodeText(ver, s) {
    if (ver === 4) return Uint8Array.from([3, ...new TextEncoder().encode(s)]);
    if (fitsLatin1(s)) return Uint8Array.from([0, ...latin1(s)]);
    const out = new Uint8Array(3 + s.length * 2);
    out.set([1, 0xff, 0xfe]);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[3 + i * 2] = c & 0xff;
      out[4 + i * 2] = c >> 8;
    }
    return out;
  }

  const frameIds = (ver) => ({
    title: ['TIT2'], artist: ['TPE1'], album: ['TALB'], track: ['TRCK'], genre: ['TCON'],
    year: ver === 4 ? ['TDRC', 'TYER'] : ['TYER', 'TDRC'], // o primeiro é o que se grava
  });

  function serializeFrame(ver, { id, flags, data }) {
    const h = new Uint8Array(10 + data.length);
    h.set([...id].map((c) => c.charCodeAt(0)));
    const n = data.length;
    h.set(ver === 4 ? [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
      : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff], 4);
    h.set(flags, 8);
    h.set(data, 10);
    return h;
  }

  // ID3v1 no fim do arquivo: atualiza se existir (senão um player antigo mostraria o nome velho)
  function patchId3v1(tail, values) {
    const put = (offset, len, s) => {
      if (s === undefined) return;
      const bytes = latin1(s).subarray(0, len);
      tail.fill(0, offset, offset + len);
      tail.set(bytes, offset);
    };
    put(3, 30, values.title);
    put(33, 30, values.artist);
    put(63, 30, values.album);
    put(93, 4, values.year?.slice(0, 4));
    // ID3v1.1: faixa no último byte do comentário
    if (values.track !== undefined && tail[125] === 0) tail[126] = parseInt(values.track, 10) || 0;
  }

  // values: { campo: texto } — '' apaga o quadro, campo ausente fica como está.
  // values.cover: { mime, data } troca a capa frontal; null tira todas as imagens.
  // values.lyrics: texto (ou LRC sincronizado) troca a letra; '' tira a letra.
  async function buildTaggedFile(file, values) {
    const { cover, lyrics, ...texts } = values;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ver: oldVer, frames, audioStart } = parseTag(bytes);
    const ver = oldVer === 4 ? 4 : 3;
    const ids = frameIds(ver);

    const replaced = new Set(Object.keys(texts).flatMap((k) => ids[k]));
    const kept = frames.filter((f) => !replaced.has(f.id)
      && !(f.id === 'APIC' && (cover === null || (cover && apicType(f.data) === 3)))
      && !(lyrics !== undefined && (f.id === 'USLT' || isLyricsTxxx(f))));
    const fresh = Object.entries(texts).filter(([, v]) => v)
      .map(([k, v]) => ({ id: ids[k][0], flags: [0, 0], data: encodeText(ver, v) }));
    if (cover) fresh.push(apicFrame(cover));
    if (lyrics) fresh.push(usltFrame(ver, lyrics));
    const body = [...fresh, ...kept].map((f) => serializeFrame(ver, f));
    const PADDING = 1024; // espaço livre para editar de novo sem regravar tudo em outros programas
    const size = body.reduce((n, f) => n + f.length, 0) + PADDING;

    const audio = bytes.slice(audioStart);
    const hasV1 = audio.length >= 128 && audio[audio.length - 128] === 0x54
      && audio[audio.length - 127] === 0x41 && audio[audio.length - 126] === 0x47; // "TAG"
    if (hasV1) patchId3v1(audio.subarray(audio.length - 128), texts);

    const header = Uint8Array.from([0x49, 0x44, 0x33, ver, 0, 0,
      (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
    return new File([header, ...body, new Uint8Array(PADDING), audio], file.name, { type: file.type || 'audio/mpeg' });
  }

  /* ---------- Preencher ---------- */

  // "01 - Banda - Música", "03. Música", "Banda_-_Música"
  function parseFileName(name) {
    let s = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const out = {};
    const num = s.match(/^(\d{1,3})(?:\s*[-.)]\s*|\s+)(?=\S)/);
    if (num) {
      out.track = String(Number(num[1]));
      s = s.slice(num[0].length);
    }
    const parts = s.split(/\s+-\s+/);
    if (parts.length >= 2) {
      out.artist = parts[0].trim();
      out.title = parts.slice(1).join(' - ').trim();
    } else {
      out.title = s;
    }
    return out;
  }

  // Pasta do arquivo, que costuma ser o nome do álbum
  function folderOf(t) {
    const p = t.path || t.file.webkitRelativePath || '';
    const parts = p.split(/[/\\]/).filter(Boolean);
    return parts.length >= 2 ? parts.at(-2) : '';
  }

  function fillFromName() {
    if (editing.length > 1) {
      fromNames = true;
      for (const k of ['title', 'artist', 'track']) {
        input(k).value = '';
        input(k).placeholder = '(do nome de cada arquivo)';
        input(k).disabled = true;
      }
      setStatus(`<b>${editing.length} FAIXAS</b> · título/artista/faixa pelo nome`);
      dirty = true;
      return;
    }
    const t = editing[0];
    const parsed = parseFileName(t.file.name);
    for (const [k, v] of Object.entries(parsed)) input(k).value = v;
    if (!input('album').value && folderOf(t)) input('album').value = folderOf(t);
    dirty = true;
  }

  /* ---------- MusicBrainz e Cover Art Archive ---------- */

  const mbQuote = (v) => `"${v.replace(/["\\]/g, ' ')}"`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isServerError = (status) => status >= 500 || status === 429;

  // O MusicBrainz aceita 1 pedido por segundo: espaça as chamadas e, se o servidor falhar
  // (500/502/503/429), tenta de novo mais duas vezes, esperando um pouco mais a cada vez
  let lastMbCall = 0;
  async function musicbrainz(entity, query) {
    const url = `https://musicbrainz.org/ws/2/${entity}?fmt=json&limit=15&query=${encodeURIComponent(query)}`;
    for (let attempt = 0; ; attempt++) {
      const wait = lastMbCall + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      lastMbCall = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return res.json();
      if (!isServerError(res.status) || attempt >= 2) {
        throw new Error(`MusicBrainz ${isServerError(res.status) ? 'fora do ar' : 'recusou a busca'} (HTTP ${res.status}), tente de novo mais tarde`);
      }
      await sleep(1500 * (attempt + 1));
    }
  }

  // Busca pela gravação (título + artista): uma opção por lançamento
  async function searchRecordings(title, artist, filter = '') {
    const data = await musicbrainz('recording', `recording:${mbQuote(title)}${artist ? ` AND artist:${mbQuote(artist)}` : ''}${filter}`);
    return candidatesFrom(data.recordings || []);
  }

  // Busca pelo disco (álbum + artista): melhor para achar a capa
  async function searchReleases(album, artist) {
    const data = await musicbrainz('release', `release:${mbQuote(album)}${artist ? ` AND artist:${mbQuote(artist)}` : ''}`);
    return [...(data.releases || [])].sort((a, b) => rank(a) - rank(b)).map((rel) => ({
      artist: creditOf(rel['artist-credit']),
      album: rel.title || '',
      year: (rel.date || '').slice(0, 4),
      releaseId: rel.id,
      groupId: rel['release-group']?.id,
    }));
  }

  // Disco primeiro quando se sabe o álbum; senão (ou sem resultado) pela música
  async function searchForCover({ title, artist, album }) {
    let found = album ? await searchReleases(album, artist) : [];
    // Para a capa vale mais o disco oficial (evita shows ao vivo, coletâneas e bootlegs)
    if (!found.length && title) found = await searchRecordings(title, artist, ' AND status:official AND primarytype:album');
    if (!found.length && title) found = await searchRecordings(title, artist);
    found.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.date || '').localeCompare(b.date || ''));
    return found;
  }

  const creditOf = (credits) => (credits || []).map((c) => c.name + (c.joinphrase || '')).join('').trim();

  // Uma opção por lançamento: álbuns oficiais e mais antigos primeiro
  function candidatesFrom(recordings) {
    const out = [];
    for (const rec of recordings) {
      const artist = creditOf(rec['artist-credit']);
      const genre = (rec.tags || []).sort((a, b) => b.count - a.count)[0]?.name || '';
      const releases = [...(rec.releases || [])].sort((a, b) => rank(a) - rank(b)
        || (a.date || '9999').localeCompare(b.date || '9999'));
      const seen = new Set();
      for (const rel of releases) {
        const key = `${rel.title}|${(rel.date || '').slice(0, 4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const medium = rel.media?.[0];
        out.push({
          title: rec.title, artist, genre,
          album: rel.title || '',
          year: (rel.date || '').slice(0, 4),
          track: medium?.track?.[0]?.number || '',
          releaseId: rel.id,
          groupId: rel['release-group']?.id,
          rank: rank(rel),
          date: rel.date || '9999',
        });
        if (seen.size >= 3) break;
      }
      if (!releases.length) out.push({ title: rec.title, artist, genre, album: '', year: (rec['first-release-date'] || '').slice(0, 4), track: '' });
    }
    return out.slice(0, 30);
  }
  function rank(rel) {
    const type = rel['release-group']?.['primary-type'];
    const secondary = rel['release-group']?.['secondary-types'] || [];
    return (rel.status === 'Official' ? 0 : 2) + (type === 'Album' && !secondary.length ? 0 : 1);
  }

  // Capa frontal do álbum (grupo de lançamentos, a capa "oficial") ou, se não houver, da edição
  // específica. O Cover Art Archive guarda as imagens no Internet Archive, que às vezes responde
  // 500/503 para uma miniatura: aí tenta o tamanho 250, depois a próxima fonte.
  // Devolve a capa, null (não tem capa) ou lança o último erro de servidor.
  async function fetchCover(c) {
    const bases = [];
    if (c.groupId) bases.push(`https://coverartarchive.org/release-group/${c.groupId}`);
    if (c.releaseId) bases.push(`https://coverartarchive.org/release/${c.releaseId}`);
    let failure = null;
    for (const base of bases) {
      for (const size of ['front-500', 'front-250']) {
        let res;
        try {
          res = await fetch(`${base}/${size}`, { signal: AbortSignal.timeout(20000) });
        } catch (err) {
          failure = new Error(err.name === 'TimeoutError' ? 'Cover Art Archive sem resposta, tente de novo'
            : 'sem conexão com o Cover Art Archive');
          continue;
        }
        if (res.status === 404) break; // esta fonte não tem capa: próxima
        if (!res.ok) {
          failure = new Error(`Cover Art Archive fora do ar (HTTP ${res.status}), tente de novo mais tarde`);
          continue;
        }
        const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
        if (!/^image\/(jpeg|png)$/.test(mime)) break;
        return { mime, data: new Uint8Array(await res.arrayBuffer()) };
      }
    }
    if (failure) throw failure;
    return null;
  }

  // Tenta a partir de "start" até achar um lançamento com capa (pulando o disco "skip", já mostrado).
  // Erro de servidor num disco não impede de tentar os outros; só é mostrado se nenhum der certo.
  async function findCover(candidates, start = 0, skip = null) {
    const tried = new Set();
    let failure = null;
    for (let i = start; i < candidates.length && tried.size < 6; i++) {
      const key = coverKey(candidates[i]);
      if (!key || key === skip || tried.has(key)) continue;
      tried.add(key);
      try {
        const cover = await fetchCover(candidates[i]);
        if (cover) return { cover, index: i };
      } catch (err) {
        failure = err;
      }
    }
    if (failure) throw failure;
    return null;
  }

  const coverKey = (c) => c.groupId || c.releaseId;

  async function lookup() {
    const title = input('title').value.trim();
    const artist = input('artist').value.trim();
    if (!title) { setStatus('Preencha o título (ou use DO NOME) antes de buscar.', true); return; }
    lookupBtn.disabled = true;
    setStatus('Procurando no MusicBrainz…');
    try {
      showResults(await searchRecordings(title, artist));
      if (!lookupResults.length) { setStatus('Nada encontrado no MusicBrainz.', true); return; }
      applyCandidate(lookupResults[0]);
      setStatus(`<b>${lookupResults.length}</b> resultado${lookupResults.length > 1 ? 's' : ''} · escolha outro na lista se precisar`);
    } catch (err) {
      setStatus(`Erro na busca: ${errorText(err)}`, true);
    } finally {
      lookupBtn.disabled = editing.length > 1;
    }
  }

  const errorText = (err) => (err.name === 'TimeoutError' ? 'sem resposta' : err.message);

  function showResults(results) {
    lookupResults = results;
    resultsEl.replaceChildren(...results.map((r, i) => new Option(
      r.title ? `${r.artist} - ${r.title} · ${r.album || '?'}${r.year ? ` (${r.year})` : ''}`
        : `${r.artist} - ${r.album}${r.year ? ` (${r.year})` : ''}`, i)));
    resultsEl.hidden = !results.length;
  }

  /* ---------- Capa no editor ---------- */

  function showThumb() {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = '';
    let src = '';
    if (pendingCover) src = thumbUrl = URL.createObjectURL(new Blob([pendingCover.data], { type: pendingCover.mime }));
    else if (pendingCover === undefined && editing.length === 1) src = coverUrl(editing[0]);
    thumbEl.hidden = !src;
    if (src) thumbEl.src = src;
    $('#tag-cover-empty').hidden = !!src;
    $('#tag-cover-empty').textContent = pendingCover === null ? 'SEM CAPA (vai remover)'
      : editing.length > 1 && pendingCover === undefined ? '(cada faixa mantém a sua)' : 'SEM CAPA';
  }

  async function downloadCover(fromIndex) {
    coverBtn.disabled = true;
    setStatus('Procurando a capa…');
    try {
      if (fromIndex === undefined) {
        const query = { title: input('title').disabled ? '' : input('title').value.trim(),
          artist: input('artist').value.trim(), album: input('album').value.trim() };
        if (!query.title && !query.album) { setStatus('Preencha o título ou o álbum antes de baixar a capa.', true); return; }
        // Reaproveita os resultados de BUSCAR; senão procura agora
        if (!lookupResults.length || editing.length > 1) showResults(await searchForCover(query));
        fromIndex = +resultsEl.value || 0;
      }
      const found = await findCover(lookupResults, fromIndex);
      if (!found) { setStatus('Nenhuma capa encontrada no Cover Art Archive.', true); return; }
      pendingCover = found.cover;
      coverFollowsResult = true;
      dirty = true;
      resultsEl.value = found.index;
      const r = lookupResults[found.index];
      setStatus(`Capa de <b>${escapeHtml(r.album || r.title || '?')}</b> · SALVAR grava no arquivo`);
      showThumb();
    } catch (err) {
      setStatus(`Erro ao baixar a capa: ${errorText(err)}`, true);
    } finally {
      coverBtn.disabled = false;
    }
  }

  async function coverFromFile(file) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setStatus('Use uma imagem JPG ou PNG.', true); return; }
    pendingCover = { mime: file.type, data: new Uint8Array(await file.arrayBuffer()) };
    coverFollowsResult = false;
    dirty = true;
    setStatus(`Capa: <b>${escapeHtml(file.name)}</b> · SALVAR grava no arquivo`);
    showThumb();
  }

  function applyCandidate(r) {
    for (const k of FIELDS) {
      if (!r[k] || input(k).disabled) continue;
      input(k).value = k === 'genre' ? r[k].replace(/\b\w/g, (c) => c.toUpperCase()) : r[k];
    }
    dirty = true;
  }

  /* ---------- Janela ---------- */

  function setStatus(html, error = false) {
    statusEl.innerHTML = html;
    statusEl.classList.toggle('error', error);
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  const thumbEl = $('#tag-cover-img');
  const coverBtn = $('#tag-cover-dl');

  function open(tracks, focus = true) {
    tracks = tracks.filter((t) => /\.mp3$/i.test(t.file.name));
    if (!tracks.length) { flashMessage('TAGS: SÓ ARQUIVOS MP3', 1600); return; }
    editing = tracks;
    fromNames = false;
    dirty = false;
    lookupResults = [];
    resultsEl.hidden = true;
    pendingCover = undefined;
    coverFollowsResult = false;
    mixed = new Set();
    initial = {};
    const multi = tracks.length > 1;
    for (const k of FIELDS) {
      const values = new Set(tracks.map((t) => t.tags?.[k] || ''));
      const same = values.size === 1;
      if (!same || (multi && PER_FILE.includes(k))) mixed.add(k);
      initial[k] = same && !(multi && PER_FILE.includes(k)) ? [...values][0] : '';
      const el = input(k);
      el.value = initial[k];
      el.placeholder = mixed.has(k) ? '(vários)' : '';
      el.disabled = multi && PER_FILE.includes(k);
    }
    lookupBtn.disabled = multi;
    setStatus(multi ? `<b>${tracks.length} FAIXAS</b> · campos em branco ficam como estão`
      : `<b>${escapeHtml(tracks[0].file.name)}</b>`);
    showThumb();
    win.hidden = false;
    if (focus && !multi) input('title').focus();
  }

  function close() {
    win.hidden = true;
    editing = [];
  }

  function valuesFor(t) {
    const v = {};
    for (const k of FIELDS) {
      const el = input(k);
      if (el.disabled) continue;
      const val = el.value.trim();
      // Em vários, campo misto deixado em branco não muda nada
      if (mixed.has(k) && !val) continue;
      if (editing.length > 1 && val === initial[k]) continue;
      v[k] = val;
    }
    if (pendingCover !== undefined) v.cover = pendingCover;
    if (fromNames) {
      const parsed = parseFileName(t.file.name);
      v.title = parsed.title;
      if (parsed.artist) v.artist = parsed.artist;
      if (parsed.track) v.track = parsed.track;
    }
    return v;
  }

  async function save() {
    const desktopTags = window.desktop?.tags;
    let ok = 0;
    const failures = [];
    for (const t of editing) {
      const values = valuesFor(t);
      if (!Object.keys(values).length) continue;
      try {
        await writeTrack(t, values);
        ok++;
      } catch (err) {
        console.warn('Falha ao gravar tags de', t.file.name, err);
        failures.push(t.file.name);
      }
    }
    if (failures.length) {
      setStatus(`Não deu para gravar: ${escapeHtml(failures.join(', '))}`, true);
      return;
    }
    const saved = desktopTags && editing.every((t) => t.path);
    flashMessage(ok ? `TAGS ${saved ? 'GRAVADAS' : 'BAIXADAS'} (${ok})` : 'NADA PARA GRAVAR', 1600);
    close();
  }

  // Grava no arquivo (desktop) ou baixa uma cópia (navegador / faixa sem caminho conhecido).
  // Devolve true quando gravou no disco.
  async function writeTrack(t, values) {
    const file = await buildTaggedFile(t.file, values);
    const desktopTags = window.desktop?.tags;
    if (desktopTags && t.path) {
      await desktopTags.write(t.path, new Uint8Array(await file.arrayBuffer()));
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    await refreshTrack(t, file);
    return !!(desktopTags && t.path);
  }

  // A faixa passa a usar o arquivo novo; o áudio em memória é o mesmo, então a reprodução continua
  async function refreshTrack(t, file) {
    t.file = file;
    const info = await readFileInfo(file);
    t.tags = info;
    releaseCover(t);
    t.title = trackTitle(file, info);
    if (!t.lrcFile) t.lyricsPromise = null;
    updateRow(t);
    if (t === currentTrack) updateNowPlaying();
  }

  window.RetroTags = { searchForCover, findCover, coverKey, writeTrack };

  function tracksToEdit() {
    const sel = playlist.filter((t) => selected.has(t.id));
    return sel.length ? sel : currentTrack ? [currentTrack] : [];
  }

  $('#pl-tag').addEventListener('click', () => {
    const tracks = tracksToEdit();
    if (!tracks.length) { flashMessage('SELECIONE UMA FAIXA', 1400); return; }
    open(tracks);
  });
  $('#tag-close').addEventListener('click', close);
  $('#tag-from-name').addEventListener('click', fillFromName);
  lookupBtn.addEventListener('click', lookup);
  resultsEl.addEventListener('change', () => {
    applyCandidate(lookupResults[+resultsEl.value]);
    if (coverFollowsResult) downloadCover(+resultsEl.value);
  });
  coverBtn.addEventListener('click', () => downloadCover());
  $('#tag-cover-file').addEventListener('click', () => $('#tag-cover-input').click());
  $('#tag-cover-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) coverFromFile(file);
  });
  $('#tag-cover-remove').addEventListener('click', () => {
    pendingCover = null;
    coverFollowsResult = false;
    dirty = true;
    showThumb();
  });
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Com o editor aberto e nada alterado, ele acompanha a seleção da playlist
  list.addEventListener('click', () => {
    if (win.hidden || dirty) return;
    const tracks = tracksToEdit();
    if (tracks.length && /\.mp3$/i.test(tracks[0].file.name)) open(tracks, false);
  });
})();
