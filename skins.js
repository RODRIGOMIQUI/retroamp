'use strict';

/* =========================================================================
   Skins — cada skin é um conjunto de cores que substitui as variáveis CSS
   de :root (style.css). Skins de arquivo (.json) ficam guardadas no app.

   Formato do arquivo:
     { "name": "Minha skin", "colors": { "lcd": "#3dff7a", "accent": "#ffb52e", ... } }
   As chaves são os nomes das variáveis sem o "--"; o que faltar usa o Clássico.
   EXPORTAR gera um arquivo com todas as chaves, bom ponto de partida para editar.
   ========================================================================= */

(() => {
  const STORE_KEY = 'retroamp-skins';

  // Todas as variáveis de cor que uma skin pode trocar
  const KEYS = [
    'page-bg', 'page-glow', 'chrome-hi', 'chrome-lo', 'edge-light', 'edge-dark', 'edge-shadow',
    'grip-hi', 'grip-lo', 'btn-hi', 'btn-lo', 'btn-bevel', 'btn-bevel-dark', 'btn-text',
    'hilite', 'label', 'accent', 'error', 'off', 'led-on', 'led-off', 'thumb-hi', 'thumb-lo', 'track',
    'lcd-bg', 'lcd-deep', 'lcd-line', 'lcd-grid', 'lcd', 'lcd-text', 'lcd-past', 'lcd-dim', 'sel-bg',
    'vis-low', 'vis-mid', 'vis-high', 'vis-top', 'vis-peak',
  ];

  const BUILT_IN = [
    { id: 'classico', name: 'Clássico', colors: {} },
    {
      id: 'ambar', name: 'Âmbar',
      colors: {
        'page-bg': '#120c06', 'page-glow': '#2a1c0e', 'chrome-hi': '#3e3226', 'chrome-lo': '#261d15',
        'edge-light': '#6a5843', 'edge-dark': '#0d0905', 'edge-shadow': '#1a130c',
        'grip-hi': '#7d6a52', 'grip-lo': '#1c150e', 'btn-hi': '#55463a', 'btn-lo': '#2f261d',
        'btn-bevel': '#806c58', 'btn-bevel-dark': '#1f1912', 'btn-text': '#ead9c2', 'hilite': '#fff4e0',
        'label': '#bfa98c', 'accent': '#ff7b2e', 'error': '#ff5a4a', 'off': '#5e5246', 'led-off': '#2a1d0c',
        'thumb-hi': '#eadfcd', 'thumb-lo': '#8a7a66', 'track': '#1d1206',
        'lcd-bg': '#0a0602', 'lcd-deep': '#120b03', 'lcd-line': '#2a1a06', 'lcd-grid': '#1a1004',
        'lcd': '#ffb000', 'lcd-text': '#e09a10', 'lcd-past': '#8a5c0a', 'lcd-dim': '#5e3d06', 'sel-bg': '#6b3a00',
        'vis-low': '#b86e00', 'vis-mid': '#ffb000', 'vis-high': '#ffd060', 'vis-top': '#fff0c0', 'vis-peak': '#ffe9b8',
      },
    },
    {
      id: 'neon', name: 'Neon',
      colors: {
        'page-bg': '#0e0818', 'page-glow': '#2a1245', 'chrome-hi': '#3a2a5a', 'chrome-lo': '#1f1636',
        'edge-light': '#6c56a0', 'edge-dark': '#07040d', 'edge-shadow': '#140d24',
        'grip-hi': '#8a6fc4', 'grip-lo': '#170f2a', 'btn-hi': '#4e3a78', 'btn-lo': '#2a1e44',
        'btn-bevel': '#8268b8', 'btn-bevel-dark': '#1a1230', 'btn-text': '#e8dcff', 'hilite': '#ffffff',
        'label': '#b4a4d8', 'accent': '#ff4fd8', 'error': '#ff6a8a', 'off': '#5a4e78', 'led-off': '#1c1430',
        'thumb-hi': '#f0e6ff', 'thumb-lo': '#8a78b4', 'track': '#120a22',
        'lcd-bg': '#05030c', 'lcd-deep': '#0a0618', 'lcd-line': '#1e1440', 'lcd-grid': '#140c2a',
        'lcd': '#3ef2ff', 'lcd-text': '#2ccbe0', 'lcd-past': '#1d7a88', 'lcd-dim': '#1a4f66', 'sel-bg': '#7a1f8c',
        'vis-low': '#3ef2ff', 'vis-mid': '#7a8cff', 'vis-high': '#d04fff', 'vis-top': '#ff4fd8', 'vis-peak': '#ffffff',
      },
    },
    {
      // Painel de nave: aço azulado, HUD ciano e detalhes em verde-ácido.
      // Além das cores, style.css dá cantos chanfrados e brilho (html[data-skin="futuro"]).
      id: 'futuro', name: 'Futuro',
      colors: {
        'page-bg': '#03060b', 'page-glow': '#0b2033', 'chrome-hi': '#141f2c', 'chrome-lo': '#0a1119',
        'edge-light': '#2b5f7a', 'edge-dark': '#010305', 'edge-shadow': '#07101a',
        'grip-hi': '#3fd8ff', 'grip-lo': '#06111b', 'btn-hi': '#1b2a3b', 'btn-lo': '#0d1621',
        'btn-bevel': '#2f6d8c', 'btn-bevel-dark': '#050b12', 'btn-text': '#cfefff', 'hilite': '#ffffff',
        'label': '#7fa8bf', 'accent': '#b6ff3d', 'error': '#ff4d6d', 'off': '#33485a',
        'led-on': '#59f3ff', 'led-off': '#0f2230', 'thumb-hi': '#e6fbff', 'thumb-lo': '#4f8fae', 'track': '#071521',
        'lcd-bg': '#020a12', 'lcd-deep': '#04111d', 'lcd-line': '#0c2a3d', 'lcd-grid': '#071a28',
        'lcd': '#59f3ff', 'lcd-text': '#3fcfe6', 'lcd-past': '#1f6f85', 'lcd-dim': '#164a5e', 'sel-bg': '#0f4a6e',
        'vis-low': '#1a6dff', 'vis-mid': '#59f3ff', 'vis-high': '#b6ff3d', 'vis-top': '#ffffff', 'vis-peak': '#b6ff3d',
      },
    },
    {
      // Verde, amarelo, azul e branco. style.css acrescenta o filete amarelo
      // entre as seções e as "estrelas" nas barras de título (html[data-skin="brasil"]).
      id: 'brasil', name: 'Brasil',
      colors: {
        'page-bg': '#00240f', 'page-glow': '#00592a', 'chrome-hi': '#0b6b34', 'chrome-lo': '#04471f',
        'edge-light': '#3fae6a', 'edge-dark': '#001a0a', 'edge-shadow': '#023318',
        'grip-hi': '#ffdf00', 'grip-lo': '#023318', 'btn-hi': '#128a45', 'btn-lo': '#06572a',
        'btn-bevel': '#5cc985', 'btn-bevel-dark': '#023318', 'btn-text': '#f4fff7', 'hilite': '#ffffff',
        'label': '#c4ead2', 'accent': '#ffdf00', 'error': '#ff6a5a', 'off': '#3d6b4f',
        'led-on': '#ffdf00', 'led-off': '#033a1b', 'thumb-hi': '#ffffff', 'thumb-lo': '#c9b400', 'track': '#001433',
        'lcd-bg': '#001a4d', 'lcd-deep': '#00205c', 'lcd-line': '#0a3a80', 'lcd-grid': '#062a66',
        'lcd': '#ffdf00', 'lcd-text': '#f2d600', 'lcd-past': '#a8982a', 'lcd-dim': '#8f8a4a', 'sel-bg': '#009c3b',
        'vis-low': '#009c3b', 'vis-mid': '#7bd13a', 'vis-high': '#ffdf00', 'vis-top': '#ffffff', 'vis-peak': '#ffffff',
      },
    },
    {
      // Notebook de alumínio: corpo prateado, tela de vidro escura, azul de sistema.
      // style.css arredonda cantos, troca a fonte e os botões da janela (html[data-skin="aluminio"]).
      id: 'aluminio', name: 'Alumínio',
      colors: {
        'page-bg': '#cfd0d3', 'page-glow': '#f2f2f4', 'chrome-hi': '#ededef', 'chrome-lo': '#d3d4d7',
        'edge-light': '#ffffff', 'edge-dark': '#a1a2a6', 'edge-shadow': '#b8b9bc',
        'grip-hi': '#c0c1c4', 'grip-lo': '#e0e0e2', 'btn-hi': '#ffffff', 'btn-lo': '#e8e8ea',
        'btn-bevel': '#ffffff', 'btn-bevel-dark': '#c7c7cc', 'btn-text': '#1d1d1f', 'hilite': '#ffffff',
        'label': '#515154', 'accent': '#0a84ff', 'error': '#ff3b30', 'off': '#aeaeb2',
        'led-on': '#0071e3', 'led-off': '#c7c7cc', 'thumb-hi': '#ffffff', 'thumb-lo': '#e5e5ea', 'track': '#48484a',
        'lcd-bg': '#1c1c1e', 'lcd-deep': '#2c2c2e', 'lcd-line': '#3a3a3c', 'lcd-grid': '#242426',
        'lcd': '#f5f5f7', 'lcd-text': '#d1d1d6', 'lcd-past': '#8e8e93', 'lcd-dim': '#7c7c80', 'sel-bg': '#0a84ff',
        'vis-low': '#0a84ff', 'vis-mid': '#64d2ff', 'vis-high': '#ffffff', 'vis-top': '#ff9f0a', 'vis-peak': '#ffffff',
      },
    },
    {
      // Couro, latão e cobre, com o display em papel envelhecido e tinta sépia.
      // style.css acrescenta rebites, canos de latão e fonte serifada (html[data-skin="steampunk"]).
      id: 'steampunk', name: 'Steampunk',
      colors: {
        'page-bg': '#1a0f08', 'page-glow': '#3d2414', 'chrome-hi': '#5a3a22', 'chrome-lo': '#2e1c10',
        'edge-light': '#c9a24a', 'edge-dark': '#120a04', 'edge-shadow': '#241508',
        'grip-hi': '#b08a3e', 'grip-lo': '#2a180b', 'btn-hi': '#e3c27a', 'btn-lo': '#9a6e2c',
        'btn-bevel': '#fff0c2', 'btn-bevel-dark': '#5a3d15', 'btn-text': '#2b1708', 'hilite': '#000000',
        'label': '#dcc28c', 'accent': '#d4892a', 'error': '#b3261e', 'off': '#7a6a52',
        'led-on': '#a8200d', 'led-off': '#5a3d15', 'thumb-hi': '#f2d38a', 'thumb-lo': '#8a6424', 'track': '#c4ad7a',
        'lcd-bg': '#e9d8ac', 'lcd-deep': '#dcc896', 'lcd-line': '#b89f6a', 'lcd-grid': '#dfcd9e',
        'lcd': '#3b2412', 'lcd-text': '#4a2e17', 'lcd-past': '#8a6e4a', 'lcd-dim': '#86694a', 'sel-bg': '#c9984a',
        'vis-low': '#6b3d1a', 'vis-mid': '#a0521d', 'vis-high': '#d4892a', 'vis-top': '#8b1a0a', 'vis-peak': '#3b2412',
      },
    },
    {
      // Amplificador valvulado: tolex preto, filete creme, painel dourado escovado e luz vermelha de ligado.
      // style.css faz a textura, o painel nas barras de título e a tela do alto-falante (html[data-skin="amp"]).
      id: 'amp', name: 'Amplificador',
      colors: {
        'page-bg': '#0b0b0b', 'page-glow': '#1e1a14', 'chrome-hi': '#1c1c1c', 'chrome-lo': '#0e0e0e',
        'edge-light': '#e8dfc8', 'edge-dark': '#000000', 'edge-shadow': '#050505',
        'grip-hi': '#d9b04c', 'grip-lo': '#6b5420', 'btn-hi': '#2a2a2a', 'btn-lo': '#0a0a0a',
        'btn-bevel': '#4a4a4a', 'btn-bevel-dark': '#000000', 'btn-text': '#e8d3a0', 'hilite': '#fff6dc',
        'label': '#c8b78a', 'accent': '#d9b04c', 'error': '#ff4a3a', 'off': '#4a4436',
        'led-on': '#ff3322', 'led-off': '#3a0d08', 'thumb-hi': '#f2d27a', 'thumb-lo': '#6b5420', 'track': '#1a1712',
        'lcd-bg': '#070605', 'lcd-deep': '#0d0b08', 'lcd-line': '#2a2416', 'lcd-grid': '#14110b',
        'lcd': '#f2d27a', 'lcd-text': '#e3cc94', 'lcd-past': '#8f7a4a', 'lcd-dim': '#7a6a42', 'sel-bg': '#6b4a10',
        'vis-low': '#b8860b', 'vis-mid': '#f2c14e', 'vis-high': '#ff8c1a', 'vis-top': '#ff2a1a', 'vis-peak': '#fff6dc',
      },
    },
    {
      id: 'bege', name: 'Bege 95',
      colors: {
        'page-bg': '#8c8a7e', 'page-glow': '#b8b5a6', 'chrome-hi': '#e4dfcf', 'chrome-lo': '#c9c3b0',
        'edge-light': '#fbf8ee', 'edge-dark': '#4a463c', 'edge-shadow': '#8f8a7a',
        'grip-hi': '#fbf8ee', 'grip-lo': '#8f8a7a', 'btn-hi': '#ece7d8', 'btn-lo': '#c4bea9',
        'btn-bevel': '#ffffff', 'btn-bevel-dark': '#8f8a7a', 'btn-text': '#2a2822', 'hilite': '#000000',
        'label': '#4f4b40', 'accent': '#b8360f', 'error': '#c0281c', 'off': '#9a9584',
        'led-on': '#1f8a12', 'led-off': '#8a8676', 'thumb-hi': '#f4f0e4', 'thumb-lo': '#a8a290', 'track': '#ddd8c6',
        'lcd-bg': '#a9b58e', 'lcd-deep': '#9eab82', 'lcd-line': '#8a9670', 'lcd-grid': '#9aa67f',
        'lcd': '#1e2a12', 'lcd-text': '#2c3a1c', 'lcd-past': '#5e6b48', 'lcd-dim': '#6a7752', 'sel-bg': '#7d8c5e',
        'vis-low': '#3a4a24', 'vis-mid': '#2c3a1c', 'vis-high': '#1e2a12', 'vis-top': '#b8360f', 'vis-peak': '#1e2a12',
      },
    },
    {
      id: 'contraste', name: 'Alto contraste',
      colors: {
        'page-bg': '#000000', 'page-glow': '#000000', 'chrome-hi': '#111111', 'chrome-lo': '#000000',
        'edge-light': '#ffffff', 'edge-dark': '#ffffff', 'edge-shadow': '#000000',
        'grip-hi': '#ffffff', 'grip-lo': '#000000', 'btn-hi': '#000000', 'btn-lo': '#000000',
        'btn-bevel': '#ffffff', 'btn-bevel-dark': '#ffffff', 'btn-text': '#ffffff', 'hilite': '#ffffff',
        'label': '#ffffff', 'accent': '#00e5ff', 'error': '#ff5050', 'off': '#888888', 'led-off': '#333333',
        'thumb-hi': '#ffffff', 'thumb-lo': '#cccccc', 'track': '#333333',
        'lcd-bg': '#000000', 'lcd-deep': '#000000', 'lcd-line': '#555555', 'lcd-grid': '#141414',
        'lcd': '#ffff00', 'lcd-text': '#ffff00', 'lcd-past': '#c8c800', 'lcd-dim': '#b4b400', 'sel-bg': '#0040ff',
        'vis-low': '#ffff00', 'vis-mid': '#ffff00', 'vis-high': '#00e5ff', 'vis-top': '#ff5050', 'vis-peak': '#ffffff',
      },
    },
  ];

  /* ---------- Estado guardado ---------- */

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return { current: typeof s.current === 'string' ? s.current : 'classico', custom: Array.isArray(s.custom) ? s.custom : [] };
    } catch {
      return { current: 'classico', custom: [] };
    }
  }
  const state = load();
  state.custom = state.custom.map((s) => sanitize(s)).filter(Boolean);

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* sem storage */ }
  }

  const allSkins = () => [...BUILT_IN, ...state.custom];
  const findSkin = (id) => allSkins().find((s) => s.id === id) || BUILT_IN[0];

  // Só aceita chaves conhecidas com valores que o navegador entende como cor
  // (nada de url(), ponto e vírgula etc. vindo de um arquivo qualquer)
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || !raw.colors || typeof raw.colors !== 'object') return null;
    const colors = {};
    for (const key of KEYS) {
      const v = raw.colors[key] ?? raw.colors[`--${key}`];
      if (typeof v === 'string' && v.length < 64 && CSS.supports('color', v)) colors[key] = v.trim();
    }
    if (!Object.keys(colors).length) return null;
    const name = String(raw.name || 'Sem nome').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Sem nome';
    return { id: raw.id && String(raw.id).startsWith('custom:') ? String(raw.id) : `custom:${name.toLowerCase()}`, name, colors, custom: true };
  }

  /* ---------- Aplicar ---------- */

  const root = document.documentElement;
  let menu = null;
  let button = null;
  let DEFAULTS = {}; // cores do Clássico, lidas de style.css em init()

  function apply(id) {
    const skin = findSkin(id);
    for (const key of KEYS) root.style.removeProperty(`--${key}`);
    for (const [key, value] of Object.entries(skin.colors)) root.style.setProperty(`--${key}`, value);
    root.dataset.skin = skin.id;
    state.current = skin.id;
    save();
    window.dispatchEvent(new Event('skinchange')); // canvas (visualizador, curva do EQ) redesenham
    renderMenu();
    return skin;
  }

  function next() {
    const list = allSkins();
    const i = list.findIndex((s) => s.id === state.current);
    const skin = apply(list[(i + 1) % list.length].id);
    window.flashMessage?.(`SKIN: ${skin.name.toUpperCase()}`);
  }

  // Aplica já no <head>, antes da primeira pintura, para não piscar o Clássico
  apply(state.current);

  /* ---------- Importar / exportar ---------- */

  async function importFile(file) {
    let skin = null;
    try { skin = sanitize(JSON.parse(await file.text())); } catch { /* JSON inválido */ }
    if (!skin) {
      alert('Arquivo de skin inválido.\n\nO formato é:\n{ "name": "Minha skin", "colors": { "lcd": "#3dff7a", ... } }\n\nUse EXPORTAR para gerar um modelo.');
      return;
    }
    if (BUILT_IN.some((s) => s.name.toLowerCase() === skin.name.toLowerCase())) {
      skin.name += ' (2)';
      skin.id = `custom:${skin.name.toLowerCase()}`;
    }
    state.custom = state.custom.filter((s) => s.id !== skin.id).concat(skin);
    apply(skin.id);
  }

  function exportCurrent() {
    const skin = findSkin(state.current);
    const css = getComputedStyle(root);
    const colors = Object.fromEntries(KEYS.map((k) => [k, css.getPropertyValue(`--${k}`).trim()]));
    const json = JSON.stringify({ name: skin.name, colors }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
    a.download = `${skin.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'skin'}.retroamp-skin.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function removeCurrent() {
    const skin = findSkin(state.current);
    if (!skin.custom || !confirm(`Remover a skin "${skin.name}"?`)) return;
    state.custom = state.custom.filter((s) => s.id !== skin.id);
    apply('classico');
  }

  /* ---------- Menu ---------- */

  function swatch(skin) {
    // cor da skin, ou o padrão de style.css quando ela não define
    const c = (k) => skin.colors[k] || DEFAULTS[k];
    const span = document.createElement('span');
    span.className = 'skin-swatch';
    for (const k of ['chrome-hi', 'lcd-bg', 'lcd', 'accent']) {
      const i = document.createElement('i');
      i.style.background = c(k);
      span.append(i);
    }
    return span;
  }

  function renderMenu() {
    if (!menu) return;
    const list = menu.querySelector('.skin-list');
    list.replaceChildren(...allSkins().map((skin) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'skin-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', skin.id === state.current);
      item.append(swatch(skin), Object.assign(document.createElement('span'), { textContent: skin.name }));
      item.addEventListener('click', () => apply(skin.id));
      return item;
    }));
    menu.querySelector('#skin-remove').hidden = !findSkin(state.current).custom;
    if (!menu.hidden) list.querySelector('[aria-checked="true"]')?.focus();
  }

  function openMenu() {
    renderMenu();
    menu.hidden = false;
    button.classList.add('on');
    const r = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(4, Math.min(r.right - w, innerWidth - w - 4))}px`;
    menu.style.top = `${r.bottom + 3}px`;
    menu.style.maxHeight = `${innerHeight - r.bottom - 10}px`;
    menu.querySelector('[aria-checked="true"]')?.focus();
  }

  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    button.classList.remove('on');
  }

  function init() {
    // Lê os valores padrão do Clássico sem as cores inline da skin atual
    const saved = root.getAttribute('style');
    root.removeAttribute('style');
    const css = getComputedStyle(root);
    DEFAULTS = Object.fromEntries(KEYS.map((k) => [k, css.getPropertyValue(`--${k}`).trim()]));
    if (saved) root.setAttribute('style', saved);

    button = document.getElementById('btn-skin');
    menu = document.getElementById('skin-menu');
    const input = document.getElementById('skin-input');
    if (!button || !menu) return;

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? openMenu() : closeMenu();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeMenu);
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('button:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); button.focus(); }
      else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });

    document.getElementById('skin-load').addEventListener('click', () => input.click());
    document.getElementById('skin-export').addEventListener('click', exportCurrent);
    document.getElementById('skin-remove').addEventListener('click', removeCurrent);
    input.addEventListener('change', () => {
      if (input.files[0]) importFile(input.files[0]);
      input.value = '';
    });
    renderMenu();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.retroSkins = { apply, next, list: () => allSkins().map(({ id, name }) => ({ id, name })), current: () => state.current };
})();
