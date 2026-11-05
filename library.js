'use strict';

/* Busca e download de música liberada (Internet Archive e Jamendo).
   Roda no processo principal: evita CORS e é quem pode gravar na pasta da biblioteca. */

const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const USER_AGENT = 'RetroAmp/1.0 (player pessoal)';
const DOWNLOAD_HOSTS = ['archive.org', 'jamendo.com'];
const EXTERNAL_HOSTS = ['archive.org', 'jamendo.com', 'creativecommons.org'];
const MAX_BYTES = 150 * 1024 * 1024;

// No Archive, só acervos em que o download é liberado pelos artistas/detentores:
// Live Music Archive (etree), netlabels, discos de 78 rpm, ou itens com licença declarada.
const ARCHIVE_SCOPE = '(collection:(etree OR netlabels OR 78rpm OR georgeblood) OR licenseurl:*)';

/* ---------- Configuração ---------- */

let config = null;
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function defaultLibraryDir() {
  let music;
  try { music = app.getPath('music'); } catch { music = path.join(app.getPath('home'), 'Música'); }
  return path.join(music, 'RetroAmp');
}

function getConfig() {
  if (!config) {
    const defaults = { libraryDir: defaultLibraryDir(), jamendoClientId: '' };
    try {
      config = { ...defaults, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
    } catch {
      config = defaults;
    }
  }
  return config;
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

/* ---------- Utilidades ---------- */

function hostAllowed(url, hosts) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
const normalize = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const phrase = (s) => `"${s.replace(/["\\]/g, ' ')}"`;

function parseLength(len) {
  if (!len) return NaN;
  if (String(len).includes(':')) return String(len).split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
  return Number(len);
}

const MP3_RANK = ['VBR MP3', '320Kbps MP3', '256Kbps MP3', '192Kbps MP3', '160Kbps MP3', '128Kbps MP3', '64Kbps MP3'];
const mp3Rank = (format) => { const i = MP3_RANK.indexOf(format); return i < 0 ? MP3_RANK.length : i; };

/* ---------- Internet Archive ---------- */

async function searchArchive(song, band) {
  // Os shows do Live Music Archive são do tipo "etree", não "audio"
  const q = ['mediatype:(audio OR etree)', ARCHIVE_SCOPE];
  if (band) q.push(`creator:(${phrase(band)})`);
  if (song) q.push(`(title:(${phrase(song)}) OR description:(${phrase(song)}))`);
  const params = new URLSearchParams({ q: q.join(' AND '), rows: '12', output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'licenseurl']) params.append('fl[]', f);
  params.append('sort[]', 'downloads desc');

  const { response } = await getJson(`https://archive.org/advancedsearch.php?${params}`);
  const wanted = normalize(song);

  const perItem = await Promise.all(response.docs.map(async (doc) => {
    try {
      const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
      const md = meta.metadata || {};
      if (md['access-restricted-item'] === 'true' || meta.is_dark) return [];

      // Um mesmo áudio costuma ter várias versões em MP3: fica com a de melhor qualidade
      const best = new Map();
      for (const f of meta.files || []) {
        if (!/\.mp3$/i.test(f.name)) continue;
        const key = f.original || f.name;
        const prev = best.get(key);
        if (!prev || mp3Rank(f.format) < mp3Rank(prev.format)) best.set(key, f);
      }

      let files = [...best.values()];
      if (wanted) files = files.filter((f) => normalize(f.title || path.basename(f.name)).includes(wanted));
      else files = files.slice(0, 15);

      return files.map((f) => {
        const url = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
        return {
          source: 'archive',
          key: `ia:${doc.identifier}/${f.name}`,
          title: f.title || path.basename(f.name, '.mp3'),
          artist: first(f.creator) || first(md.creator) || first(doc.creator),
          album: first(md.title) || first(doc.title),
          duration: parseLength(f.length),
          download: url,
          stream: url,
          page: `https://archive.org/details/${doc.identifier}`,
          license: first(md.licenseurl) || first(doc.licenseurl),
        };
      });
    } catch {
      return [];
    }
  }));
  return perItem.flat().slice(0, 60);
}

/* ---------- Jamendo ---------- */

async function searchJamendo(song, band) {
  const clientId = getConfig().jamendoClientId;
  if (!clientId) throw new Error('falta a chave do Jamendo');
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: '30',
    search: [song, band].filter(Boolean).join(' '),
    audiodownload_allowed: 'true',
    audioformat: 'mp32',
    include: 'licenses',
  });
  const data = await getJson(`https://api.jamendo.com/v3.0/tracks/?${params}`);
  if (data.headers?.status !== 'success') {
    throw new Error(data.headers?.code === 5 ? 'chave do Jamendo inválida' : data.headers?.error_message || 'erro');
  }
  return data.results
    .filter((t) => t.audiodownload_allowed && t.audiodownload)
    .map((t) => ({
      source: 'jamendo',
      key: `jm:${t.id}`,
      title: t.name,
      artist: t.artist_name,
      album: t.album_name,
      duration: Number(t.duration),
      download: t.audiodownload.replace(/^http:/, 'https:'),
      stream: (t.audio || t.audiodownload).replace(/^http:/, 'https:'),
      page: t.shareurl,
      license: t.license_ccurl,
    }));
}

/* ---------- Download ---------- */

function id3Frame(id, text) {
  // Codificação 1 = UTF-16 com BOM (compatível com ID3v2.3)
  const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le'), Buffer.from([0, 0])]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function buildId3({ title, artist, album }) {
  const frames = Buffer.concat(Object.entries({ TIT2: title, TPE1: artist, TALB: album })
    .filter(([, v]) => v)
    .map(([id, v]) => id3Frame(id, String(v))));
  const size = frames.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([header, frames]);
}

const isMp3 = (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
const hasId3 = (b) => b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;

function safeName(s) {
  return String(s).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150) || 'faixa';
}

function uniquePath(dir, base) {
  let candidate = path.join(dir, `${base}.mp3`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} (${n}).mp3`);
  return candidate;
}

const activeDownloads = new Map(); // jobId → AbortController

async function download(sender, { jobId, url, title, artist, album }) {
  if (!hostAllowed(url, DOWNLOAD_HOSTS)) throw new Error('endereço de download não permitido');
  const controller = new AbortController();
  activeDownloads.set(jobId, controller);
  try {
    return await fetchToLibrary(sender, controller.signal, { jobId, url, title, artist, album });
  } catch (err) {
    if (controller.signal.aborted) throw new Error('cancelado');
    throw err;
  } finally {
    activeDownloads.delete(jobId);
  }
}

async function fetchToLibrary(sender, cancelSignal, { jobId, url, title, artist, album }) {
  const signal = AbortSignal.any([cancelSignal, AbortSignal.timeout(10 * 60 * 1000)]);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal });
  if (!res.ok) throw new Error(res.status === 403 ? 'download não liberado para esta faixa' : `HTTP ${res.status}`);
  if (!hostAllowed(res.url, DOWNLOAD_HOSTS)) throw new Error('redirecionado para um site não permitido');

  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_BYTES) throw new Error('arquivo grande demais');
  const chunks = [];
  let received = 0;
  let lastReport = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (received > MAX_BYTES) throw new Error('arquivo grande demais');
    if (Date.now() - lastReport > 150) {
      lastReport = Date.now();
      if (!sender.isDestroyed()) sender.send('download:progress', { jobId, received, total });
    }
  }

  let data = Buffer.concat(chunks);
  if (!isMp3(data)) throw new Error('o arquivo recebido não é um MP3');
  if (!hasId3(data)) data = Buffer.concat([buildId3({ title, artist, album }), data]);

  const dir = getConfig().libraryDir;
  await fs.promises.mkdir(dir, { recursive: true });
  const file = uniquePath(dir, safeName(artist ? `${artist} - ${title}` : title));
  await fs.promises.writeFile(file, data);
  return { path: file, name: path.basename(file), data };
}

/* ---------- IPC ---------- */

const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

function registerLibraryIpc() {
  ipcMain.handle('library:get-config', () => {
    const { libraryDir, jamendoClientId } = getConfig();
    return { libraryDir, jamendoClientId };
  });

  ipcMain.handle('library:set-jamendo-key', (_e, key) => {
    getConfig().jamendoClientId = str(key);
    saveConfig();
  });

  ipcMain.handle('library:choose-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Pasta da biblioteca',
      defaultPath: getConfig().libraryDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!canceled && filePaths[0]) {
      getConfig().libraryDir = filePaths[0];
      saveConfig();
    }
    return getConfig().libraryDir;
  });

  ipcMain.handle('library:open-dir', async () => {
    const dir = getConfig().libraryDir;
    await fs.promises.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });

  ipcMain.handle('library:search', (_e, source, song, band) => {
    song = str(song);
    band = str(band);
    if (!song && !band) return [];
    if (source === 'archive') return searchArchive(song, band);
    if (source === 'jamendo') return searchJamendo(song, band);
    throw new Error('fonte desconhecida');
  });

  ipcMain.handle('library:download', (e, item) => download(e.sender, {
    jobId: str(item?.jobId),
    url: str(item?.url) || '',
    title: str(item?.title) || 'faixa',
    artist: str(item?.artist),
    album: str(item?.album),
  }));

  ipcMain.handle('library:cancel', (_e, jobId) => {
    activeDownloads.get(str(jobId))?.abort();
  });

  ipcMain.handle('library:open-external', (_e, url) => {
    if (hostAllowed(url, EXTERNAL_HOSTS)) return shell.openExternal(url);
  });
}

module.exports = { registerLibraryIpc };
