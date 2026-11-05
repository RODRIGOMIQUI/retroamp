'use strict';

/* =========================================================================
   RetroAmp — player de MP3 estilo anos 90, feito com Web Audio API
   ========================================================================= */

const $ = (sel) => document.querySelector(sel);

const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_PRESETS = {
  'Flat':     [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Rock':     [5, 3, -2, -4, -1, 2, 5, 6, 6, 6],
  'Pop':      [-1, 2, 4, 5, 3, 0, -1, -1, -1, -1],
  'Jazz':     [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  'Clássica': [0, 0, 0, 0, 0, 0, -4, -4, -4, -6],
  'Dance':    [6, 5, 2, 0, 0, -3, -4, -4, 0, 0],
  'Graves+':  [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  'Agudos+':  [0, 0, 0, 0, 0, 2, 4, 6, 7, 8],
  'Vocal':    [-2, -3, -1, 2, 4, 4, 3, 1, 0, -2],
  'Ao vivo':  [-3, 0, 2, 3, 3, 3, 2, 1, 1, 1],
};
const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac|webm)$/i;
const baseName = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();

/* ---------- Configurações persistentes ---------- */

const settings = loadSettings();

function loadSettings() {
  const defaults = {
    volume: 80, balance: 0,
    eqOn: true, preamp: 0, bands: Array(10).fill(0), preset: 'Flat',
    shuffle: false, repeat: 'off',
    showEq: true, showPl: true,
    visMode: 'spectrum', timeMode: 'elapsed',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('retroamp') || '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try { localStorage.setItem('retroamp', JSON.stringify(settings)); } catch { /* sem storage */ }
}

/* ---------- Motor de áudio ----------
   <audio> → preamp → 10 filtros (EQ) → balanço → analisador → volume → saída */

const audio = new Audio();
audio.preload = 'auto';

let actx = null;
let preampNode, panner, analyser, volumeNode;
let filters = [];

function ensureAudioGraph() {
  if (actx) return;
  actx = new AudioContext();
  const source = actx.createMediaElementSource(audio);
  preampNode = actx.createGain();
  filters = EQ_FREQS.map((freq, i) => {
    const f = actx.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    return f;
  });
  panner = actx.createStereoPanner();
  analyser = actx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  volumeNode = actx.createGain();

  let node = source.connect(preampNode);
  for (const f of filters) node = node.connect(f);
  node.connect(panner).connect(analyser).connect(volumeNode).connect(actx.destination);

  applyEq();
  applyVolume();
  applyBalance();
}

function applyEq() {
  if (!actx) return;
  const on = settings.eqOn;
  preampNode.gain.value = on ? 10 ** (settings.preamp / 20) : 1;
  filters.forEach((f, i) => { f.gain.value = on ? settings.bands[i] : 0; });
}

function applyVolume() {
  if (volumeNode) volumeNode.gain.value = (settings.volume / 100) ** 2;
}

function applyBalance() {
  if (panner) panner.pan.value = settings.balance / 100;
}

/* ---------- Leitura de tags (ID3v2 / ID3v1) e cabeçalho MP3 ---------- */

const ID3_FRAMES = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album',
  USLT: 'lyrics', ULT: 'lyrics',
  TYER: 'year', TYE: 'year', TDRC: 'year', TRCK: 'track', TRK: 'track', TCON: 'genre', TCO: 'genre',
};

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function decodeId3Text(d) {
  if (!d.length) return '';
  const enc = d[0];
  let bytes = d.subarray(1);
  let label = 'iso-8859-1';
  if (enc === 1) label = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le';
  else if (enc === 2) label = 'utf-16be';
  else if (enc === 3) label = 'utf-8';
  return new TextDecoder(label).decode(bytes).split('\0')[0].trim();
}

// USLT: codificação (1) + idioma (3) + descritor terminado em \0 (ou \0\0 em UTF-16) + texto.
// TXXX tem o mesmo formato, sem o idioma. Devolve { description, text }.
function decodeDescribedFrame(d, hasLanguage) {
  const enc = d[0];
  const descStart = hasLanguage ? 4 : 1;
  let i = descStart;
  if (enc === 1 || enc === 2) {
    while (i + 1 < d.length && (d[i] || d[i + 1])) i += 2;
    i += 2;
  } else {
    while (i < d.length && d[i]) i++;
    i += 1;
  }
  const withEnc = (bytes) => {
    const out = new Uint8Array(bytes.length + 1);
    out[0] = enc;
    out.set(bytes, 1);
    return decodeId3Text(out);
  };
  return { description: withEnc(d.subarray(descStart, i)), text: withEnc(d.subarray(i)) };
}

// APIC (v2.3/v2.4): codificação + MIME terminado em \0 + tipo + descrição + imagem.
// PIC (v2.2): codificação + formato de 3 letras ("JPG"/"PNG") + tipo + descrição + imagem.
function decodePicture(d, v22) {
  const enc = d[0];
  let i = 1;
  let mime;
  if (v22) {
    mime = /png/i.test(String.fromCharCode(...d.subarray(1, 4))) ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    while (i < d.length && d[i]) i++;
    mime = decodeLatin1(d.subarray(1, i)) || 'image/jpeg';
    if (!mime.includes('/')) mime = `image/${mime.toLowerCase().replace('jpg', 'jpeg')}`;
    i++;
  }
  const type = d[i++];
  if (enc === 1 || enc === 2) {
    while (i + 1 < d.length && (d[i] || d[i + 1])) i += 2;
    i += 2;
  } else {
    while (i < d.length && d[i]) i++;
    i++;
  }
  return { mime, type, data: d.slice(i) };
}

function decodeLatin1(d) {
  return new TextDecoder('iso-8859-1').decode(d).split('\0')[0].trim();
}

async function readFileInfo(file) {
  const info = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    let audioStart = 0;

    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) { // "ID3"
      const ver = head[3];
      const size = syncsafe(head, 6);
      audioStart = 10 + size;
      const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      const idLen = ver === 2 ? 3 : 4;
      const hdrLen = ver === 2 ? 6 : 10;
      let pos = 0;
      if (ver >= 3 && head[5] & 0x40) pos = ver === 4 ? syncsafe(buf, 0) : u32(buf, 0) + 4;

      while (pos + hdrLen <= buf.length) {
        const id = String.fromCharCode(...buf.subarray(pos, pos + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const fsize = ver === 2 ? (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5]
          : ver === 4 ? syncsafe(buf, pos + 4) : u32(buf, pos + 4);
        const key = ID3_FRAMES[id];
        const frame = buf.subarray(pos + hdrLen, pos + hdrLen + fsize);
        if (key === 'lyrics') {
          info.lyrics ||= decodeDescribedFrame(frame, true).text;
        } else if (id === 'TXXX' || id === 'TXX') {
          // Alguns programas (e o ffmpeg) gravam a letra como TXXX "LYRICS" / "UNSYNCEDLYRICS"
          const { description, text } = decodeDescribedFrame(frame, false);
          if (/lyrics|uslt/i.test(description)) info.lyrics ||= text;
        } else if (id === 'APIC' || id === 'PIC') {
          // Prefere a capa frontal (tipo 3); senão fica com a primeira imagem
          const pic = decodePicture(frame, id === 'PIC');
          if (pic.data.length && (!info.cover || (pic.type === 3 && info.cover.type !== 3))) info.cover = pic;
        } else if (key && !info[key]) {
          info[key] = decodeId3Text(frame);
        }
        pos += hdrLen + fsize;
      }
    }

    if (!info.title && file.size > 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) { // "TAG"
        info.title = decodeLatin1(tail.subarray(3, 33));
        info.artist = info.artist || decodeLatin1(tail.subarray(33, 63));
        info.album = info.album || decodeLatin1(tail.subarray(63, 93));
        info.year = info.year || decodeLatin1(tail.subarray(93, 97));
      }
    }

    // Primeiro quadro MPEG: taxa de amostragem e mono/estéreo
    const chunk = new Uint8Array(await file.slice(audioStart, audioStart + 16384).arrayBuffer());
    const RATES = [44100, 48000, 32000];
    for (let i = 0; i + 4 <= chunk.length; i++) {
      if (chunk[i] !== 0xff || (chunk[i + 1] & 0xe0) !== 0xe0) continue;
      const version = (chunk[i + 1] >> 3) & 3;
      const layer = (chunk[i + 1] >> 1) & 3;
      const brIdx = chunk[i + 2] >> 4;
      const srIdx = (chunk[i + 2] >> 2) & 3;
      if (version === 1 || layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
      const div = version === 3 ? 1 : version === 2 ? 2 : 4;
      info.khz = RATES[srIdx] / div / 1000;
      info.mono = (chunk[i + 3] >> 6) === 3;
      break;
    }
  } catch (err) {
    console.warn('Falha ao ler tags de', file.name, err);
  }
  return info;
}

function probeDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d) => {
      a.onloadedmetadata = a.onerror = null;
      a.removeAttribute('src');
      a.load();
      resolve(d);
    };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(NaN);
    a.src = url;
  });
}

/* ---------- Utilidades ---------- */

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', `${p}%`);
}

/* ---------- Playlist ---------- */

let playlist = [];
let nextId = 1;
let currentTrack = null; // faixa "da vez" (destacada)
let loadedTrack = null;  // faixa carregada no <audio>
let stopped = true;
let consecutiveErrors = 0;
let selected = new Set();
let lastClickedId = null;
const history = [];

const list = $('#pl-list');
const search = $('#pl-search');

const fileKey = (f) => `${f.name}|${f.size}`;
const trackTitle = (file, info) => (info.title
  ? (info.artist ? `${info.artist} - ${info.title}` : info.title)
  : file.name.replace(/\.[^.]+$/, ''));

async function addFiles(files) {
  // Letras .lrc com o mesmo nome do MP3 (ex.: "Banda - Música.lrc") viram a letra da faixa
  const lrcByName = new Map([...files].filter((f) => /\.lrc$/i.test(f.name)).map((f) => [baseName(f.name), f]));
  let lrcAttached = 0;
  for (const t of playlist) {
    const lrc = lrcByName.get(baseName(t.file.name));
    if (lrc) { t.lrcFile = lrc; t.lyricsPromise = null; lrcByName.delete(baseName(t.file.name)); lrcAttached++; }
  }

  const audioFiles = [...files].filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
  if (audioFiles.some((f) => f.webkitRelativePath)) {
    audioFiles.sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath, undefined, { numeric: true }));
  }
  if (!audioFiles.length) {
    flashMessage(lrcAttached ? `LETRA ADICIONADA (${lrcAttached})` : 'NENHUM ARQUIVO DE ÁUDIO');
    return;
  }

  // Ignora o que já está na playlist (ou repetido no mesmo lote). Nome + tamanho
  // identifica o arquivo tanto vindo do disco quanto de um download do NET.
  const seen = new Set(playlist.map((t) => fileKey(t.file)));
  const newFiles = audioFiles.filter((f) => {
    const key = fileKey(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const skipped = audioFiles.length - newFiles.length;
  if (!newFiles.length) {
    flashMessage(skipped > 1 ? 'JÁ ESTÃO NA PLAYLIST' : 'JÁ ESTÁ NA PLAYLIST');
    return;
  }

  const added = newFiles.map((file) => ({
    id: nextId++,
    file,
    // Caminho no disco (só no app desktop), para gravar as tags no próprio arquivo
    path: file.savedPath || window.desktop?.pathFor(file) || '',
    url: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, ''),
    duration: NaN,
    khz: null,
    mono: false,
    error: false,
    tags: null,
    lrcFile: lrcByName.get(baseName(file.name)) || null,
  }));
  playlist.push(...added);
  if (!currentTrack) currentTrack = added[0];
  renderPlaylist();
  updateNowPlaying();
  flashMessage(`+${added.length} FAIXA${added.length > 1 ? 'S' : ''}`
    + (skipped ? ` · ${skipped} JÁ ESTAVA${skipped > 1 ? 'M' : ''}` : ''), skipped ? 2000 : 1200);

  for (const t of added) {
    const [info, duration] = await Promise.all([readFileInfo(t.file), probeDuration(t.url)]);
    t.title = trackTitle(t.file, info);
    t.tags = info;
    Object.assign(t, { khz: info.khz ?? null, mono: !!info.mono });
    if (Number.isFinite(duration)) t.duration = duration;
    if (!playlist.includes(t)) continue;
    updateRow(t);
    updateFooter();
    if (t === currentTrack) updateNowPlaying();
  }
}

// URL da capa embutida na faixa (criada sob demanda e liberada junto com a faixa)
function coverUrl(t) {
  if (!t?.tags?.cover) return '';
  t.coverUrl ||= URL.createObjectURL(new Blob([t.tags.cover.data], { type: t.tags.cover.mime }));
  return t.coverUrl;
}

function releaseCover(t) {
  if (t.coverUrl) URL.revokeObjectURL(t.coverUrl);
  t.coverUrl = '';
}

function makeRow(t) {
  const li = document.createElement('li');
  li.dataset.id = t.id;
  li.draggable = true;
  li.classList.toggle('current', t === currentTrack);
  li.classList.toggle('selected', selected.has(t.id));
  li.classList.toggle('error', t.error);
  const title = document.createElement('span');
  title.className = 'pl-title';
  title.textContent = `${playlist.indexOf(t) + 1}. ${t.title}`;
  const dur = document.createElement('span');
  dur.className = 'pl-dur';
  dur.textContent = Number.isFinite(t.duration) ? fmtTime(t.duration) : '';
  li.append(title, dur);
  return li;
}

function renderPlaylist() {
  const q = search.value.trim().toLowerCase();
  const visible = q ? playlist.filter((t) => t.title.toLowerCase().includes(q)) : playlist;
  list.replaceChildren(...visible.map(makeRow));
  $('#pl-empty').hidden = playlist.length > 0;
  updateFooter();
}

function rowOf(t) {
  return list.querySelector(`li[data-id="${t.id}"]`);
}

function updateRow(t) {
  const li = rowOf(t);
  if (li) li.replaceWith(makeRow(t));
}

function refreshRowClasses() {
  for (const li of list.children) {
    const id = +li.dataset.id;
    li.classList.toggle('selected', selected.has(id));
    li.classList.toggle('current', currentTrack?.id === id);
  }
}

function updateFooter() {
  const total = playlist.reduce((sum, t) => sum + (Number.isFinite(t.duration) ? t.duration : 0), 0);
  const n = playlist.length;
  $('#pl-total').textContent = `${n} faixa${n === 1 ? '' : 's'} · ${fmtTime(total)}`;
}

function scrollToCurrent() {
  if (currentTrack) rowOf(currentTrack)?.scrollIntoView({ block: 'nearest' });
}

function removeTracks(tracks) {
  if (!tracks.length) return;
  const gone = new Set(tracks);
  if (loadedTrack && gone.has(loadedTrack)) unload();
  if (currentTrack && gone.has(currentTrack)) {
    const remaining = playlist.filter((t) => !gone.has(t));
    const idx = playlist.indexOf(currentTrack);
    currentTrack = remaining.find((t) => playlist.indexOf(t) > idx) || remaining[0] || null;
  }
  for (const t of tracks) {
    URL.revokeObjectURL(t.url);
    releaseCover(t);
    selected.delete(t.id);
  }
  playlist = playlist.filter((t) => !gone.has(t));
  renderPlaylist();
  updateNowPlaying();
}

function sortPlaylist() {
  playlist.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
  renderPlaylist();
  updateNowPlaying();
}

/* ---------- Transporte ---------- */

function startPlayback() {
  ensureAudioGraph();
  if (actx.state === 'suspended') actx.resume();
  audio.play().catch((err) => {
    if (err.name !== 'AbortError') console.warn(err);
  });
}

function loadTrack(t, autoplay = true, pushHistory = true) {
  if (pushHistory && currentTrack && currentTrack !== t) history.push(currentTrack);
  currentTrack = t;
  loadedTrack = t;
  audio.src = t.url;
  stopped = !autoplay;
  if (autoplay) startPlayback();
  refreshRowClasses();
  updateNowPlaying();
  scrollToCurrent();
}

function unload() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedTrack = null;
  stopped = true;
  updateState();
}

function play() {
  if (!playlist.length) { $('#file-input').click(); return; }
  if (!currentTrack) currentTrack = playlist[0];
  if (loadedTrack !== currentTrack) { loadTrack(currentTrack, true, false); return; }
  if (!audio.paused || stopped) audio.currentTime = 0;
  stopped = false;
  startPlayback();
}

function pause() {
  if (!loadedTrack || stopped) return;
  if (audio.paused) startPlayback();
  else audio.pause();
}

function togglePlay() {
  if (loadedTrack && !stopped && !audio.paused) audio.pause();
  else if (loadedTrack && !stopped) startPlayback();
  else play();
}

function stop() {
  if (!loadedTrack) return;
  audio.pause();
  audio.currentTime = 0;
  stopped = true;
  updateState();
}

function next(fromEnded = false) {
  if (!playlist.length) return;
  const autoplay = fromEnded || (!audio.paused && !stopped);
  if (fromEnded && settings.repeat === 'one') {
    audio.currentTime = 0;
    startPlayback();
    return;
  }
  let t;
  if (settings.shuffle && playlist.length > 1) {
    do t = playlist[Math.floor(Math.random() * playlist.length)];
    while (t === currentTrack);
  } else {
    const i = playlist.indexOf(currentTrack) + 1;
    if (i >= playlist.length) {
      if (fromEnded && settings.repeat === 'off') { stop(); return; }
      t = playlist[0];
    } else {
      t = playlist[i];
    }
  }
  loadTrack(t, autoplay);
}

function prev() {
  if (!playlist.length) return;
  if (!stopped && audio.currentTime > 3) { audio.currentTime = 0; return; }
  const autoplay = !audio.paused && !stopped;
  if (settings.shuffle) {
    while (history.length && !playlist.includes(history.at(-1))) history.pop();
    if (history.length) { loadTrack(history.pop(), autoplay, false); return; }
  }
  let i = playlist.indexOf(currentTrack) - 1;
  if (i < 0) i = settings.repeat === 'all' ? playlist.length - 1 : 0;
  loadTrack(playlist[i], autoplay);
}

function seekBy(seconds) {
  if (!loadedTrack || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration);
}

/* ---------- Display ---------- */

const timeEl = $('#time');
const seekEl = $('#seek');
const marqueeEl = $('#marquee');
let seeking = false;
let marqueeText = '';
let marqueeOffset = 0;
let flashText = '';
let flashUntil = 0;
let marqueeChars = 30;

function updateNowPlaying() {
  const t = currentTrack;
  if (t) {
    const idx = playlist.indexOf(t);
    marqueeText = `${idx >= 0 ? idx + 1 + '. ' : ''}${t.title} (${fmtTime(t.duration)})`;
    $('#kbps').textContent = Number.isFinite(t.duration) && t.duration > 0
      ? Math.round((t.file.size * 8) / t.duration / 1000) : '---';
    $('#khz').textContent = t.khz ? Math.round(t.khz) : '--';
    $('#mono').classList.toggle('on', !!t.khz && t.mono);
    $('#stereo').classList.toggle('on', !!t.khz && !t.mono);
    document.title = `${t.title} — RetroAmp`;
  } else {
    marqueeText = 'RETROAMP  ·  ARRASTE MÚSICAS AQUI OU CLIQUE EM ⏏';
    $('#kbps').textContent = '---';
    $('#khz').textContent = '--';
    $('#mono').classList.remove('on');
    $('#stereo').classList.remove('on');
    document.title = 'RetroAmp';
  }
  marqueeOffset = 0;
  renderMarquee();
  updateMediaSession();
  document.dispatchEvent(new CustomEvent('trackchange'));
}

function flashMessage(text, ms = 1200) {
  flashText = text;
  flashUntil = performance.now() + ms;
  renderMarquee();
}

function renderMarquee() {
  if (performance.now() < flashUntil) {
    marqueeEl.textContent = flashText;
    return;
  }
  if (marqueeText.length <= marqueeChars) {
    marqueeEl.textContent = marqueeText;
    return;
  }
  const loop = `${marqueeText}  ***  `;
  marqueeEl.textContent = (loop + loop).slice(marqueeOffset, marqueeOffset + marqueeChars);
}

function measureMarquee() {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(20);
  probe.style.visibility = 'hidden';
  marqueeEl.append(probe);
  const charW = probe.getBoundingClientRect().width / 20;
  probe.remove();
  const style = getComputedStyle(marqueeEl);
  const inner = marqueeEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (charW > 0) marqueeChars = Math.max(8, Math.floor(inner / charW));
  renderMarquee();
}

setInterval(() => {
  if (marqueeText.length > marqueeChars) {
    marqueeOffset = (marqueeOffset + 1) % (marqueeText.length + 7);
  }
  renderMarquee();
}, 170);

function updateState() {
  const el = $('#play-state');
  const state = !loadedTrack || stopped ? 'stopped' : audio.paused ? 'paused' : 'playing';
  el.className = `play-state ${state}`;
  el.setAttribute('aria-label', { stopped: 'Parado', paused: 'Pausado', playing: 'Tocando' }[state]);
  timeEl.classList.toggle('blink', state === 'paused');
  timeEl.classList.toggle('dim', state === 'stopped');
  seekEl.disabled = !loadedTrack;
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none';
  }
}

function updateTimeUI() {
  const dur = audio.duration;
  const hasDur = loadedTrack && Number.isFinite(dur) && dur > 0;
  const pos = seeking && hasDur ? (seekEl.value / 1000) * dur : audio.currentTime;
  let txt;
  if (!loadedTrack || stopped) txt = '00:00';
  else if (settings.timeMode === 'remaining' && hasDur) txt = `-${fmtTime(dur - pos)}`;
  else txt = fmtTime(pos);
  if (timeEl.textContent !== txt) timeEl.textContent = txt;

  if (!seeking) {
    const v = hasDur ? Math.round((audio.currentTime / dur) * 1000) : 0;
    if (+seekEl.value !== v) { seekEl.value = v; paintRange(seekEl); }
  }
}

/* ---------- Visualizador ---------- */

const vis = $('#vis');
const vctx = vis.getContext('2d');
const BARS = 19;
const bars = new Float32Array(BARS);
const peaks = new Float32Array(BARS);
const peakHold = new Uint8Array(BARS);
let freqData = null;
let timeData = null;
let visW = 152;
let visH = 40;
let barGradient = null;
let visColors = {};

// Cores do canvas vêm das variáveis CSS da skin (ver skins.js)
const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

function resizeVis() {
  const dpr = window.devicePixelRatio || 1;
  visW = vis.clientWidth || 152;
  visH = vis.clientHeight || 40;
  vis.width = Math.round(visW * dpr);
  vis.height = Math.round(visH * dpr);
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  barGradient = vctx.createLinearGradient(0, visH, 0, 0);
  barGradient.addColorStop(0, cssColor('vis-low'));
  barGradient.addColorStop(0.55, cssColor('vis-mid'));
  barGradient.addColorStop(0.8, cssColor('vis-high'));
  barGradient.addColorStop(1, cssColor('vis-top'));
  visColors = { bg: cssColor('lcd-bg'), grid: cssColor('lcd-grid'), peak: cssColor('vis-peak'), lcd: cssColor('lcd') };
}

function bandLevel(b) {
  const nyquist = actx.sampleRate / 2;
  const len = freqData.length;
  const fmin = 40;
  const fmax = 16000;
  const lo = fmin * (fmax / fmin) ** (b / BARS);
  const hi = fmin * (fmax / fmin) ** ((b + 1) / BARS);
  const start = Math.floor((lo / nyquist) * len);
  const end = Math.max(start + 1, Math.ceil((hi / nyquist) * len));
  let max = 0;
  for (let i = start; i < end && i < len; i++) if (freqData[i] > max) max = freqData[i];
  return (max / 255) ** 1.4;
}

function drawVis() {
  const W = visW;
  const H = visH;
  vctx.fillStyle = visColors.bg;
  vctx.fillRect(0, 0, W, H);

  // grade de fundo
  vctx.fillStyle = visColors.grid;
  for (let x = 1; x < W; x += 4) for (let y = 1; y < H; y += 4) vctx.fillRect(x, y, 1, 1);

  if (settings.visMode === 'off') return;
  const active = analyser && loadedTrack && !audio.paused && !stopped;

  if (settings.visMode === 'spectrum') {
    if (active) {
      freqData ||= new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);
    }
    const slot = W / BARS;
    const bw = Math.max(2, Math.floor(slot) - 2);
    for (let b = 0; b < BARS; b++) {
      const target = active ? bandLevel(b) : 0;
      bars[b] = target > bars[b] ? target : bars[b] * 0.86;
      if (bars[b] >= peaks[b]) { peaks[b] = bars[b]; peakHold[b] = 18; }
      else if (peakHold[b] > 0) peakHold[b]--;
      else peaks[b] = Math.max(0, peaks[b] - 0.018);

      const x = Math.round(b * slot + (slot - bw) / 2);
      const h = Math.round(bars[b] * (H - 2));
      if (h > 0) {
        vctx.fillStyle = barGradient;
        vctx.fillRect(x, H - h, bw, h);
      }
      if (peaks[b] > 0.02) {
        vctx.fillStyle = visColors.peak;
        vctx.fillRect(x, H - Math.round(peaks[b] * (H - 2)) - 2, bw, 1);
      }
    }
    // segmentos horizontais estilo LCD
    vctx.globalAlpha = 0.85;
    vctx.fillStyle = visColors.bg;
    for (let y = H - 3; y > 0; y -= 3) vctx.fillRect(0, y, W, 1);
    vctx.globalAlpha = 1;
  } else {
    vctx.strokeStyle = visColors.lcd;
    vctx.lineWidth = 1;
    vctx.shadowColor = visColors.lcd;
    vctx.shadowBlur = 4;
    vctx.beginPath();
    if (active) {
      timeData ||= new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(timeData);
      const step = timeData.length / W;
      for (let x = 0; x < W; x++) {
        const y = (timeData[Math.floor(x * step)] / 255) * H;
        x ? vctx.lineTo(x, y) : vctx.moveTo(x, y);
      }
    } else {
      vctx.moveTo(0, H / 2);
      vctx.lineTo(W, H / 2);
    }
    vctx.stroke();
    vctx.shadowBlur = 0;
  }
}

/* ---------- Caixas de som (skin Amplificador) ----------
   Cone de cima segue os graves, o de baixo os médios. */

const ampCabs = document.querySelectorAll('.amp-cab');
{
  // 4 cones por caixa; graves e médios em diagonal para o movimento não ficar igual
  const cone = (mid) => `<div class="cab-spk${mid ? ' mid' : ''}"><div class="cone"><div class="dust"></div></div></div>`;
  const box = (angled, mids) => `
    <div class="cab-box${angled ? ' angled' : ''}">
      <div class="cab-grille">${mids.map(cone).join('')}
        <span class="cab-badge">RetroAmp</span><span class="cab-plate">4×12</span>
      </div>
    </div>`;
  const stack = `
    <div class="amp-head">
      <span class="cab-badge">RetroAmp</span>
      <div class="head-panel">
        <i class="head-switch power"></i><i class="head-switch"></i><i class="head-led"></i>
        <span class="head-knobs"><i></i><i></i><i></i><i></i><i></i><i></i></span>
      </div>
    </div>
    ${box(true, [false, true, true, false])}
    ${box(false, [true, false, false, true])}
    <div class="cab-wheels"><i></i><i></i></div>`;
  for (const cab of ampCabs) cab.innerHTML = stack;
}
const speaker = { bass: 0, mid: 0, data: null };

// Nível de 0 a 1 de uma faixa de frequências: mistura média e pico (som estreito
// também mexe o cone) e corta o "chão" para o cone não ficar sempre meio empurrado.
function speakerLevel(fromHz, toHz, floor) {
  const hzPerBin = actx.sampleRate / 2 / speaker.data.length;
  const a = Math.max(1, Math.floor(fromHz / hzPerBin));
  const b = Math.max(a + 1, Math.ceil(toHz / hzPerBin));
  let sum = 0;
  let max = 0;
  for (let i = a; i < b; i++) {
    sum += speaker.data[i];
    if (speaker.data[i] > max) max = speaker.data[i];
  }
  const v = (sum / (b - a) + max) / 2 / 255;
  return Math.min(1, Math.max(0, (v - floor) / (1 - floor))) ** 1.5;
}

function pumpSpeakers() {
  if (document.documentElement.dataset.skin !== 'amp') return;
  let bass = 0;
  let mid = 0;
  if (analyser && loadedTrack && !audio.paused && !stopped) {
    speaker.data ||= new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(speaker.data);
    bass = speakerLevel(40, 160, 0.5);
    mid = speakerLevel(200, 2000, 0.4);
  }
  // sobe na hora, volta devagar (como um cone de verdade)
  speaker.bass = bass > speaker.bass ? bass : speaker.bass * 0.85;
  speaker.mid = mid > speaker.mid ? mid : speaker.mid * 0.8;
  const playing = !!(loadedTrack && !audio.paused && !stopped);
  for (const cab of ampCabs) {
    cab.classList.toggle('playing', playing);
    cab.style.setProperty('--bass', speaker.bass.toFixed(3));
    cab.style.setProperty('--mid', speaker.mid.toFixed(3));
  }
}

// Na versão web o #app quebra linha quando falta largura: aí as caixas somem
// em vez de cair para baixo do player. (No app desktop a janela cresce.)
function fitSpeakers() {
  const root = document.documentElement;
  root.classList.remove('cabs-off');
  if (root.dataset.skin !== 'amp' || ampCabs.length < 2) return;
  const [left, right] = ampCabs;
  if (Math.abs(left.getBoundingClientRect().top - right.getBoundingClientRect().top) > 1) {
    root.classList.add('cabs-off');
  }
}
window.addEventListener('resize', fitSpeakers);
window.addEventListener('skinchange', fitSpeakers);
{
  const ro = new ResizeObserver(() => fitSpeakers());
  for (const el of [$('#app'), $('#col-1'), $('#col-2')]) ro.observe(el);
  window.addEventListener('load', fitSpeakers);
}

function frame() {
  updateTimeUI();
  drawVis();
  pumpSpeakers();
  requestAnimationFrame(frame);
}

/* ---------- Equalizador ---------- */

const eqCurve = $('#eq-curve');
const eqCtx = eqCurve.getContext('2d');
const eqSliders = [];
let preampSlider;

function buildEq() {
  const wrap = $('#eq-bands');
  const mk = (label, value, cls, onInput) => {
    const band = document.createElement('div');
    band.className = `eq-band ${cls}`;
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: -12, max: 12, step: 0.5, value });
    input.title = `${label}: ${value} dB`;
    input.addEventListener('input', () => {
      input.title = `${label}: ${input.value} dB`;
      paintRange(input);
      onInput(+input.value);
      flashMessage(`EQ ${label}: ${+input.value > 0 ? '+' : ''}${input.value} dB`, 900);
    });
    input.addEventListener('dblclick', () => {
      input.value = 0;
      input.dispatchEvent(new Event('input'));
    });
    const lab = document.createElement('label');
    lab.textContent = label;
    band.append(input, lab);
    wrap.append(band);
    paintRange(input);
    return input;
  };

  preampSlider = mk('PRE', settings.preamp, 'preamp', (v) => {
    settings.preamp = v;
    eqChanged();
  });
  EQ_FREQS.forEach((f, i) => {
    const label = f >= 1000 ? `${f / 1000}K` : String(f);
    eqSliders.push(mk(label, settings.bands[i], '', (v) => {
      settings.bands[i] = v;
      settings.preset = '';
      $('#eq-preset').value = '';
      eqChanged();
    }));
  });

  const sel = $('#eq-preset');
  sel.append(new Option('PRESETS', ''));
  for (const name of Object.keys(EQ_PRESETS)) sel.append(new Option(name, name));
  sel.value = settings.preset in EQ_PRESETS ? settings.preset : '';
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    setBands(EQ_PRESETS[sel.value]);
    settings.preset = sel.value;
    flashMessage(`EQ: ${sel.value.toUpperCase()}`);
    eqChanged();
  });

  $('#eq-reset').addEventListener('click', () => {
    setBands(EQ_PRESETS.Flat);
    settings.preamp = 0;
    preampSlider.value = 0;
    paintRange(preampSlider);
    settings.preset = 'Flat';
    sel.value = 'Flat';
    eqChanged();
  });

  $('#eq-on').addEventListener('click', () => {
    settings.eqOn = !settings.eqOn;
    flashMessage(`EQUALIZADOR ${settings.eqOn ? 'LIGADO' : 'DESLIGADO'}`);
    eqChanged();
  });
}

function setBands(values) {
  settings.bands = [...values];
  eqSliders.forEach((s, i) => { s.value = values[i]; paintRange(s); });
}

function eqChanged() {
  applyEq();
  $('#eq-on').classList.toggle('on', settings.eqOn);
  $('#eq-win').classList.toggle('eq-off', !settings.eqOn);
  drawEqCurve();
  saveSettings();
}

function drawEqCurve() {
  const dpr = window.devicePixelRatio || 1;
  const W = eqCurve.clientWidth;
  const H = eqCurve.clientHeight;
  if (!W || !H) return;
  eqCurve.width = Math.round(W * dpr);
  eqCurve.height = Math.round(H * dpr);
  eqCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  eqCtx.clearRect(0, 0, W, H);

  eqCtx.fillStyle = cssColor('lcd-dim');
  eqCtx.fillRect(0, Math.round(H / 2), W, 1);

  const pts = settings.bands.map((v, i) => [
    4 + (i / (settings.bands.length - 1)) * (W - 8),
    H / 2 - (v / 12) * (H / 2 - 3),
  ]);
  eqCtx.strokeStyle = cssColor(settings.eqOn ? 'accent' : 'off');
  eqCtx.lineWidth = 1.5;
  eqCtx.beginPath();
  eqCtx.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    eqCtx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
  eqCtx.stroke();
}

/* ---------- Media Session (teclas de mídia do sistema) ---------- */

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !currentTrack) return;
  const [artist, ...rest] = currentTrack.title.split(' - ');
  const cover = coverUrl(currentTrack);
  navigator.mediaSession.metadata = new MediaMetadata({
    ...(rest.length ? { title: rest.join(' - '), artist } : { title: currentTrack.title }),
    album: currentTrack.tags?.album || '',
    artwork: cover ? [{ src: cover, type: currentTrack.tags.cover.mime }] : [],
  });
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => (loadedTrack && !stopped ? startPlayback() : play()),
    pause: () => audio.pause(),
    stop,
    previoustrack: prev,
    nexttrack: () => next(),
    seekto: (d) => { audio.currentTime = d.seekTime; },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* ação não suportada */ }
  }
}

/* ---------- Eventos do <audio> ---------- */

audio.addEventListener('play', () => { stopped = false; updateState(); });
audio.addEventListener('pause', updateState);
audio.addEventListener('playing', () => { consecutiveErrors = 0; });
audio.addEventListener('ended', () => next(true));
audio.addEventListener('loadedmetadata', () => {
  if (loadedTrack && !Number.isFinite(loadedTrack.duration) && Number.isFinite(audio.duration)) {
    loadedTrack.duration = audio.duration;
    updateRow(loadedTrack);
    updateFooter();
    updateNowPlaying();
  }
  updateState();
});
audio.addEventListener('error', () => {
  if (!loadedTrack) return;
  loadedTrack.error = true;
  updateRow(loadedTrack);
  flashMessage('ERRO: FORMATO NÃO SUPORTADO', 2000);
  consecutiveErrors++;
  if (consecutiveErrors < playlist.length) setTimeout(() => next(true), 600);
  else { consecutiveErrors = 0; unload(); }
});

/* ---------- Ligações da interface ---------- */

function bindUI() {
  $('#btn-play').addEventListener('click', play);
  $('#btn-pause').addEventListener('click', pause);
  $('#btn-stop').addEventListener('click', stop);
  $('#btn-next').addEventListener('click', () => next());
  $('#btn-prev').addEventListener('click', prev);
  $('#btn-open').addEventListener('click', () => $('#file-input').click());
  $('#pl-add').addEventListener('click', () => $('#file-input').click());
  $('#pl-add-dir').addEventListener('click', () => $('#dir-input').click());

  for (const id of ['#file-input', '#dir-input']) {
    const input = $(id);
    input.addEventListener('change', () => {
      const wasEmpty = !loadedTrack;
      const firstNew = playlist.length;
      addFiles(input.files);
      input.value = '';
      // Ao abrir arquivos com o player parado, já começa a tocar
      if (wasEmpty && playlist[firstNew]) loadTrack(playlist[firstNew], true, false);
    });
  }

  // Volume / balanço
  const vol = $('#volume');
  const bal = $('#balance');
  vol.value = settings.volume;
  bal.value = settings.balance;
  paintRange(vol);
  paintRange(bal);
  vol.addEventListener('input', () => {
    settings.volume = +vol.value;
    paintRange(vol);
    applyVolume();
    flashMessage(`VOLUME: ${settings.volume}%`, 900);
    saveSettings();
  });
  bal.addEventListener('input', () => {
    let v = +bal.value;
    if (Math.abs(v) < 8) v = 0;
    bal.value = v;
    settings.balance = v;
    applyBalance();
    flashMessage(v === 0 ? 'BALANÇO: CENTRO' : `BALANÇO: ${Math.abs(v)}% ${v < 0 ? 'ESQ' : 'DIR'}`, 900);
    saveSettings();
  });
  bal.addEventListener('dblclick', () => { bal.value = 0; bal.dispatchEvent(new Event('input')); });

  // Seek
  paintRange(seekEl);
  seekEl.addEventListener('input', () => { seeking = true; paintRange(seekEl); });
  seekEl.addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (seekEl.value / 1000) * audio.duration;
    seeking = false;
  });

  // Tempo decorrido/restante
  timeEl.addEventListener('click', () => {
    settings.timeMode = settings.timeMode === 'elapsed' ? 'remaining' : 'elapsed';
    saveSettings();
  });

  // Visualizador
  vis.addEventListener('click', () => {
    const modes = ['spectrum', 'scope', 'off'];
    settings.visMode = modes[(modes.indexOf(settings.visMode) + 1) % modes.length];
    flashMessage(`VIS: ${{ spectrum: 'ESPECTRO', scope: 'OSCILOSCÓPIO', off: 'DESLIGADO' }[settings.visMode]}`, 900);
    saveSettings();
  });

  // Shuffle / repeat
  const shuffleBtn = $('#btn-shuffle');
  const repeatBtn = $('#btn-repeat');
  const syncModes = () => {
    shuffleBtn.classList.toggle('on', settings.shuffle);
    repeatBtn.classList.toggle('on', settings.repeat !== 'off');
    repeatBtn.textContent = settings.repeat === 'one' ? 'REPEAT 1' : 'REPEAT';
  };
  shuffleBtn.addEventListener('click', () => {
    settings.shuffle = !settings.shuffle;
    flashMessage(`ALEATÓRIO: ${settings.shuffle ? 'SIM' : 'NÃO'}`);
    syncModes();
    saveSettings();
  });
  repeatBtn.addEventListener('click', () => {
    settings.repeat = { off: 'all', all: 'one', one: 'off' }[settings.repeat];
    flashMessage(`REPETIR: ${{ off: 'NÃO', all: 'PLAYLIST', one: 'FAIXA' }[settings.repeat]}`);
    syncModes();
    saveSettings();
  });
  syncModes();

  // Mostrar/ocultar janelas
  const syncWindows = () => {
    $('#eq-win').hidden = !settings.showEq;
    $('#pl-win').hidden = !settings.showPl;
    $('#btn-eq').classList.toggle('on', settings.showEq);
    $('#btn-pl').classList.toggle('on', settings.showPl);
    if (settings.showEq) drawEqCurve();
  };
  $('#btn-eq').addEventListener('click', () => { settings.showEq = !settings.showEq; syncWindows(); saveSettings(); });
  $('#btn-pl').addEventListener('click', () => { settings.showPl = !settings.showPl; syncWindows(); saveSettings(); });
  syncWindows();

  // Playlist: seleção, duplo clique, reordenação
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) { selected.clear(); refreshRowClasses(); return; }
    const id = +li.dataset.id;
    if (e.shiftKey && lastClickedId != null) {
      const ids = [...list.children].map((el) => +el.dataset.id);
      const [a, b] = [ids.indexOf(lastClickedId), ids.indexOf(id)].sort((x, y) => x - y);
      selected = new Set(ids.slice(Math.max(0, a), b + 1));
    } else if (e.ctrlKey || e.metaKey) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      lastClickedId = id;
    } else {
      selected = new Set([id]);
      lastClickedId = id;
    }
    refreshRowClasses();
  });
  list.addEventListener('dblclick', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const t = playlist.find((x) => x.id === +li.dataset.id);
    if (t) { t.error = false; loadTrack(t); updateRow(t); }
  });

  let dragId = null;
  const clearDropMarks = () => list.querySelectorAll('.drop-before, .drop-after, .dragging')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    dragId = +li.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.textContent);
    li.classList.add('dragging');
  });
  list.addEventListener('dragend', () => { dragId = null; clearDropMarks(); });
  list.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const li = e.target.closest('li');
    if (li) {
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  list.addEventListener('drop', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    e.stopPropagation();
    const li = e.target.closest('li');
    const moving = playlist.find((t) => t.id === dragId);
    const target = li && playlist.find((t) => t.id === +li.dataset.id);
    const after = !li || li.classList.contains('drop-after');
    clearDropMarks();
    dragId = null;
    if (!moving || target === moving) return;
    playlist.splice(playlist.indexOf(moving), 1);
    const idx = target ? playlist.indexOf(target) + (after ? 1 : 0) : playlist.length;
    playlist.splice(idx, 0, moving);
    renderPlaylist();
    updateNowPlaying();
  });

  $('#pl-remove').addEventListener('click', () => removeTracks(playlist.filter((t) => selected.has(t.id))));
  $('#pl-clear').addEventListener('click', () => {
    if (playlist.length && confirm('Limpar toda a playlist?')) removeTracks([...playlist]);
  });
  $('#pl-sort').addEventListener('click', sortPlaylist);
  search.addEventListener('input', renderPlaylist);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; renderPlaylist(); search.blur(); }
    if (e.key === 'Enter' && list.firstElementChild) list.firstElementChild.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });

  // Arrastar arquivos/pastas do sistema
  let dragDepth = 0;
  const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth++;
    document.body.classList.add('dragging-files');
  });
  document.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging-files'); }
  });
  document.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  document.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging-files');
    const files = await filesFromDataTransfer(e.dataTransfer);
    const wasEmpty = !loadedTrack;
    const firstNew = playlist.length;
    addFiles(files);
    if (wasEmpty && playlist[firstNew]) loadTrack(playlist[firstNew], true, false);
  });

  // Atalhos de teclado
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range') return;
    if (tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && tag !== 'INPUT') {
        e.preventDefault();
        selected = new Set([...list.children].map((li) => +li.dataset.id));
        refreshRowClasses();
      }
      return;
    }
    const isRange = tag === 'INPUT';
    const actions = {
      ' ': togglePlay,
      z: prev, x: play, c: pause, v: stop, b: () => next(),
      l: () => $('#file-input').click(),
      s: () => $('#btn-shuffle').click(),
      r: () => $('#btn-repeat').click(),
      t: () => $('#pl-tag').click(),
      k: () => window.retroSkins?.next(),
      Delete: () => $('#pl-remove').click(),
      Enter: () => {
        const t = playlist.find((x) => selected.has(x.id));
        if (t) loadTrack(t);
      },
    };
    if (!isRange) {
      Object.assign(actions, {
        ArrowLeft: () => seekBy(-5),
        ArrowRight: () => seekBy(5),
        ArrowUp: () => { const v = $('#volume'); v.value = Math.min(100, +v.value + 5); v.dispatchEvent(new Event('input')); },
        ArrowDown: () => { const v = $('#volume'); v.value = Math.max(0, +v.value - 5); v.dispatchEvent(new Event('input')); },
      });
    }
    const fn = actions[e.key] || actions[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }
  });

  window.addEventListener('resize', () => { resizeVis(); measureMarquee(); drawEqCurve(); });
  window.addEventListener('skinchange', () => { resizeVis(); drawEqCurve(); });
}

async function filesFromDataTransfer(dt) {
  const entries = [...dt.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = [];
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        children.push(...batch);
      } while (batch.length);
      children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const c of children) await walk(c);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/* ---------- App desktop (Electron) ---------- */

function bindDesktop() {
  if (!window.desktop) return;
  document.documentElement.classList.add('desktop');
  $('#win-min').addEventListener('click', () => window.desktop.minimize());
  $('#win-close').addEventListener('click', () => window.desktop.close());
  // A janela acompanha o tamanho do conteúdo (seções ocultas, recolhidas, 1 ou 2 colunas)
  new ResizeObserver(() => {
    const { width, height } = $('#app').getBoundingClientRect();
    window.desktop.setSize(width, height);
  }).observe($('#app'));
}

/* ---------- Inicialização ---------- */

bindDesktop();

buildEq();
eqChanged();
bindUI();
renderPlaylist();
updateNowPlaying();
updateState();
resizeVis();
measureMarquee();
document.fonts?.ready.then(measureMarquee);
requestAnimationFrame(frame);
