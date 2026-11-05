'use strict';

/* =========================================================================
   Organização das seções em até duas colunas.
   - Arraste uma seção pela barra de título para mudar de lugar/coluna.
   - Duplo clique no título recolhe/expande a seção.
   - Botão de colunas na janela principal alterna entre 1 e 2 colunas.
   A janela principal fica sempre no topo da 1ª coluna.
   Usa globais de player.js: $, settings, saveSettings.
   ========================================================================= */

(() => {
  const SECTION_IDS = ['eq-win', 'pl-win', 'ly-win', 'net-win', 'tag-win', 'cv-win'];
  const DEFAULT_TWO_COLUMNS = [['eq-win', 'pl-win', 'tag-win'], ['cv-win', 'ly-win', 'net-win']];
  // Quanto cada seção cresce quando a coluna dela é mais curta que a outra
  const GROW_WEIGHT = { 'ly-win': 2, 'pl-win': 1, 'net-win': 1, 'cv-win': 1 };
  const cols = [$('#col-1'), $('#col-2')];
  const mainWin = $('#main-win');
  const sections = SECTION_IDS.map((id) => document.getElementById(id));

  settings.collapsed ||= {};

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
  const PAIR = ['pl-win', 'net-win'];

  function setFill(el, grow) {
    el.classList.toggle('fill', grow > 0);
    el.style.flexGrow = grow > 0 ? String(grow) : '';
  }

  // Playlist e Buscar música em colunas diferentes ficam com a mesma altura (topos e
  // bases alinhados): as duas ganham uma altura fixa igual e as outras seções que
  // crescem (a letra) compensam a diferença do que fica acima delas.
  function alignPair() {
    const [pl, net] = PAIR.map((id) => document.getElementById(id));
    for (const el of [pl, net]) el.style.flex = '';
    if (!isOpen(pl) || !isOpen(net) || pl.parentElement === net.parentElement) return false;

    // Mede tudo no tamanho natural (sem esticar)
    for (const col of cols) for (const el of winsOf(col)) setFill(el, 0);
    const pairHeight = Math.max(pl.getBoundingClientRect().height, net.getBoundingClientRect().height);
    const above = (el) => winsOf(el.parentElement).filter((w) => w !== el && isVisible(w))
      .reduce((sum, w) => sum + w.getBoundingClientRect().height, 0);
    const [a, b] = [above(pl), above(net)];
    const shorter = a < b ? pl.parentElement : net.parentElement;
    const growers = (col) => winsOf(col).filter((w) => isOpen(w) && !PAIR.includes(w.id) && GROW_WEIGHT[w.id]);
    // Só dá para alinhar se a coluna mais baixa tiver algo para crescer (ex.: a letra)
    if (Math.abs(a - b) > 1 && !growers(shorter).length) return false;

    for (const el of [pl, net]) el.style.flex = `0 0 ${Math.ceil(pairHeight)}px`;
    for (const col of cols) for (const el of growers(col)) setFill(el, GROW_WEIGHT[el.id]);
    return true;
  }

  function refreshColumns() {
    // Coluna sem nenhuma seção visível some (e a janela encolhe)
    // (seções "desktop-only" ficam escondidas por CSS na versão web)
    for (const col of cols) col.classList.toggle('empty', !winsOf(col).some(isVisible));
    if (alignPair()) return;

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
    const twoCols = currentLayout()[1].length > 0;
    if (twoCols) applyLayout([[...currentLayout()[0], ...currentLayout()[1]], []]);
    else applyLayout(DEFAULT_TWO_COLUMNS);
    flashMessage(twoCols ? 'LAYOUT: 1 COLUNA' : 'LAYOUT: 2 COLUNAS');
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
    textContent: '⇢ Solte aqui para criar uma 2ª coluna',
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
        if (cols[1].classList.contains('empty')) cols[0].append(newColDrop);
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
    else if (col === cols[0] && newColDrop.isConnected) col.insertBefore(marker, newColDrop);
    else col.append(marker);
  });

  document.addEventListener('drop', (e) => {
    if (!isSectionDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = dragging;
    if (newColDrop.classList.contains('over')) {
      cols[1].append(el);
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

  applyLayout(settings.layout || [SECTION_IDS, []]);
  // As alturas mudam quando a fonte LCD carrega ou a janela muda de tamanho
  document.fonts?.ready.then(refreshColumns);
  window.addEventListener('resize', refreshColumns);
})();
