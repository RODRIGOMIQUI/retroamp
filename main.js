'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { registerLibraryIpc } = require('./library');

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    // Só reaproveita a posição se ela ainda cair dentro de algum monitor
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
    return visible ? { x, y } : {};
  } catch {
    return {};
  }
}

function saveWindowState(win) {
  try {
    const { x, y } = win.getBounds();
    fs.writeFileSync(statePath(), JSON.stringify({ x, y }));
  } catch { /* sem permissão de escrita: ignora */ }
}

function createWindow() {
  const win = new BrowserWindow({
    ...loadWindowState(),
    width: 460,
    height: 600,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'RetroAmp',
    backgroundColor: '#23252c',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // Links externos nunca abrem dentro do player
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on('window:set-size', (e, width, height) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !Number.isFinite(width) || !Number.isFinite(height)) return;
  // Nunca maior que a área útil da tela: o que passar disso vira rolagem dentro da janela
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const w = Math.min(Math.ceil(width), workArea.width);
  const h = Math.min(Math.ceil(height), workArea.height);
  // Janelas não redimensionáveis ignoram setContentSize em alguns gerenciadores de janela
  win.setResizable(true);
  win.setContentSize(w, h);
  win.setResizable(false);

  // Se cresceu para fora da tela, puxa de volta (sem efeito no Wayland, que não deixa posicionar)
  const b = win.getBounds();
  const x = Math.max(workArea.x, Math.min(b.x, workArea.x + workArea.width - b.width));
  const y = Math.max(workArea.y, Math.min(b.y, workArea.y + workArea.height - b.height));
  if (x !== b.x || y !== b.y) win.setPosition(x, y);
});

// Grava o MP3 com as tags novas (montado em tags.js). Escreve num temporário e troca,
// para não deixar o arquivo pela metade se algo falhar.
ipcMain.handle('tags:write', async (_e, file, data) => {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.mp3$/i.test(file) || !(data instanceof Uint8Array)) {
    throw new Error('arquivo inválido');
  }
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error('arquivo inválido');
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.retroamp-tmp`);
  try {
    await fs.promises.writeFile(tmp, data, { mode: stat.mode });
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
});

app.whenReady().then(() => {
  registerLibraryIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
