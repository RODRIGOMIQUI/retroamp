'use strict';

/* =========================================================================
   Organização das seções em três colunas, ocupando a tela toda.
   - Arraste uma seção pela barra de título para mudar de lugar/coluna.
   - Duplo clique no título recolhe/expande a seção.
   - Botão de layout na janela principal volta ao arranjo padrão.
   A janela principal fica sempre no topo da 1ª coluna; a coluna que tem a
   biblioteca ocupa a largura que sobrar.
   Usa globais de player.js: $, settings, saveSettings.
   ========================================================================= */

(() => {
  const SECTION_IDS = ['lib-win', 'eq-win', 'pl-win', 'ly-win', 'net-win', 'tag-win', 'cv-win'];
  const DEFAULT_LAYOUT = [['eq-win', 'cv-win', 'ly-win'], ['lib-win', 'net-win'], ['pl-win', 'tag-win']];
  // Quanto cada seção cresce para preencher a altura da coluna
  // A capa fica fora: ela tem a altura da largura (quadrada) e a sobra vai para as outras
  const GROW_WEIGHT = { 'lib-win': 3, 'ly-win': 2, 'pl-win': 2, 'net-win': 1 };
  const cols = [$('#col-1'), $('#col-2'), $('#col-3')];
  const mainWin = $('#main-win');
  const sections = SECTION_IDS.map((id) => document.getElementById(id));

  settings.collapsed ||= {};
  // Layout antigo (até 2 colunas, sem a biblioteca) não serve mais: começa no padrão
  if (settings.layout && (settings.layout.length !== 3 || !settings.layout.flat().includes('lib-win'))) delete settings.layout;

  /* ---------- Aplicar / salvar o layout ---------- */

  function applyLayout(layout) {
    const placed = new Set();
    layout.forEach((ids, c) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el || placed.has(id) || !SECTION_IDS.includes(id)) continue;
        cols[c].append(el);
        placed.add(id);
      }
    });
    // Seções novas (ou ausentes do layout salvo) vão para o fim da 1ª coluna
    for (const el of sections) if (!placed.has(el.id)) cols[0].append(el);
    cols[0].prepend(mainWin);
    refreshColumns();
  }

  function currentLayout() {
    return cols.map((col) => [...col.children].filter((el) => SECTION_IDS.includes(el.id)).map((el) => el.id));
  }

  function save() {
    settings.layout = currentLayout();
    saveSettings();
  }

  const isVisible = (el) => el.classList.contains('win') && !el.hidden && getComputedStyle(el).display !== 'none';
  const isOpen = (el) => el !== mainWin && isVisible(el) && !el.classList.contains('collapsed');
  const winsOf = (col) => [...col.children].filter((el) => el.classList.contains('win'));
  function setFill(el, grow) {
    el.classList.toggle('fill', grow > 0);
    el.style.flexGrow = grow > 0 ? String(grow) : '';
  }

  function refreshColumns() {
    // Coluna sem nenhuma seção visível some
    // (seções "desktop-only" ficam escondidas por CSS na versão web)
    for (const col of cols) col.classList.toggle('empty', !winsOf(col).some(isVisible));
    // A coluna da biblioteca fica com a largura que sobra; sem biblioteca aberta, a do meio
    const lib = document.getElementById('lib-win');
    const wide = isOpen(lib) ? lib.parentElement : cols.find((c) => c !== cols[0] && !c.classList.contains('empty')) || cols[0];
    for (const col of cols) col.classList.toggle('wide', col === wide);

    // Quem preenche a sobra: letra, playlist e resultados da busca (a letra cresce mais).
    // Sem nenhuma delas aberta, a última seção aberta da coluna estica.
    for (const col of cols) {
      const open = winsOf(col).filter(isOpen);
      let fillers = open.filter((el) => GROW_WEIGHT[el.id]);
      if (!fillers.length && open.length) fillers = [open.at(-1)];
      for (const el of winsOf(col)) setFill(el, fillers.includes(el) ? GROW_WEIGHT[el.id] || 1 : 0);
    }
  }

  // Os botões EQ/PL/NET/LY mudam o atributo "hidden" das seções
  new MutationObserver(refreshColumns).observe($('#app'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });

  $('#btn-layout').addEventListener('click', () => {
    applyLayout(DEFAULT_LAYOUT);
    for (const el of sections) if (el.classList.contains('collapsed')) setCollapsed(el, false);
    flashMessage('LAYOUT PADRÃO');
    save();
    window.dispatchEvent(new Event('resize'));
  });

  /* ---------- Recolher ---------- */

  function setCollapsed(el, collapsed) {
    el.classList.toggle('collapsed', collapsed);
    settings.collapsed[el.id] = collapsed;
    refreshColumns();
    if (!collapsed) window.dispatchEvent(new Event('resize')); // redesenha canvas (curva do EQ etc.)
  }

  for (const el of sections) {
    el.classList.toggle('collapsed', !!settings.collapsed[el.id]);
    const bar = el.querySelector('.titlebar');
    bar.title = 'Arraste para mover · duplo clique para recolher';
    bar.addEventListener('dblclick', () => {
      setCollapsed(el, !el.classList.contains('collapsed'));
      saveSettings();
    });
  }

  /* ---------- Arrastar ---------- */

  const DRAG_TYPE = 'application/x-retroamp-section';
  const marker = Object.assign(document.createElement('div'), { className: 'drop-marker' });
  const newColDrop = Object.assign(document.createElement('div'), {
    className: 'col-drop',
    textContent: '⇢ Solte aqui para usar a coluna vazia',
  });
  let dragging = null;

  const isSectionDrag = (e) => dragging && [...e.dataTransfer.types].includes(DRAG_TYPE);

  for (const el of sections) {
    const bar = el.querySelector('.titlebar');
    bar.draggable = true;
    bar.addEventListener('dragstart', (e) => {
      dragging = el;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_TYPE, el.id);
      const r = el.getBoundingClientRect();
      e.dataTransfer.setDragImage(el, e.clientX - r.left, e.clientY - r.top);
      // Atrasar a mudança visual evita que ela entre na imagem do arraste
      requestAnimationFrame(() => {
        el.classList.add('dragging-section');
        document.body.classList.add('dragging-sections');
        if (cols.some((c) => c.classList.contains('empty'))) cols.filter((c) => !c.classList.contains('empty')).at(-1).append(newColDrop);
      });
    });
    bar.addEventListener('dragend', endDrag);
  }

  function endDrag() {
    dragging?.classList.remove('dragging-section');
    dragging = null;
    marker.remove();
    newColDrop.remove();
    newColDrop.classList.remove('over');
    document.body.classList.remove('dragging-sections');
    refreshColumns();
  }

  // Coluna sob o ponteiro (ou a mais próxima). Considera x e y porque, em telas
  // estreitas da versão web, a 2ª coluna quebra para baixo da 1ª.
  function columnAt(x, y) {
    const visible = cols.filter((c) => !c.classList.contains('empty'));
    const dist = (c) => {
      const r = c.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      return dx * dx + dy * dy;
    };
    return visible.sort((a, b) => dist(a) - dist(b))[0];
  }

  document.addEventListener('dragover', (e) => {
    if (!isSectionDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (newColDrop.isConnected && newColDrop.contains(e.target)) {
      newColDrop.classList.add('over');
      marker.remove();
      return;
    }
    newColDrop.classList.remove('over');

    const col = columnAt(e.clientX, e.clientY);
    if (!col) return;
    const candidates = [...col.children].filter((c) => c.classList.contains('win') && c !== mainWin && c !== dragging && !c.hidden);
    const before = candidates.find((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (before) col.insertBefore(marker, before);
    else if (newColDrop.parentElement === col) col.insertBefore(marker, newColDrop);
    else col.append(marker);
  });

  document.addEventListener('drop', (e) => {
    if (!isSectionDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = dragging;
    if (newColDrop.classList.contains('over')) {
      cols.find((c) => c.classList.contains('empty')).append(el);
    } else if (marker.isConnected) {
      marker.replaceWith(el);
    }
    cols[0].prepend(mainWin);
    endDrag();
    save();
    window.dispatchEvent(new Event('resize'));
  }, true);

  document.addEventListener('dragleave', (e) => {
    if (dragging && !e.relatedTarget) marker.remove();
  });

  applyLayout(settings.layout || DEFAULT_LAYOUT);
  // As alturas mudam quando a fonte LCD carrega ou a janela muda de tamanho
  document.fonts?.ready.then(refreshColumns);
  window.addEventListener('resize', refreshColumns);
})();
