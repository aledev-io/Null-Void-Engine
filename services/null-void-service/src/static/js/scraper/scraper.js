/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · Null-Void Engine
   Punto de entrada: coordina config, api, state, socket y ui.
   Config: window.SCRAPER_CONFIG (token, user, user_avatar_url)
   ──────────────────────────────────────────────────────────── */
import { SCRAPER_CONFIG } from './config.js';
import { state, saveFavorites, saveDiscarded, setScraperPresets, getScraperPresets } from './state.js';
import { fetchAPI } from './api.js';
import {
  toggleTheme,
  toggleSidebar,
  toggleSection,
  toggleUserMenu,
  filterBrandsList,
  updateDetailButtons,
  toggleRowSelection,
  toggleSelectAll,
  updateBulkActionBar,
  goToPage,
  renderTable,
  openProduct,
  fetchDescription,
  openLightbox,
  closeLightbox,
  closeProductView,
  showConfigView,
  savePccompTerms,
  closeConfigView,
  showToast,
  drawGraph,
  buildTelegramMessage,
  copyAtHomeSummary,
  toggleAtHomeConfigSection,
  setWizardStep,
  showBotRulesView,
  closeBotRulesView,
  loadBotRules,
  toggleChatbot
} from './ui.js';
import { socket } from './socket.js';


/* ────────────────────────────────────────────────────────────
   PUENTE GLOBAL: los inline handlers del HTML y del JS generado
   (onclick="openProduct(...)", etc.) requieren funciones globales.
   En módulos ES las funciones no cuelgan de window: se exponen aqui.
   ──────────────────────────────────────────────────────────── */
Object.assign(window, {
  filterTable, loadSelectedPreset, onFluctuationChange, saveScraperRef, toggleSelectAll, validatePriceRange, batchScrapeListed, bulkAction, cancelPresetSave, cancelRoutine, closeBotRulesView, closeConfigView, closeLightbox, closeProductView, createBotRule, cycleFluctuationSort, deleteSelectedPreset, exportListPdf, fetchDescription, loadFilters, saveConfig, savePccompTerms, sendSelectedToTelegram, showAllProducts, showConfigView, showDiscarded, showFavorites, sortByDistance, startCreatePreset, startRenamePreset, startRoutine, startScrape, toggleChatbot, toggleDiscarded, toggleFavorite, toggleSection, toggleSidebar, toggleTheme, toggleUserMenu, copyAtHomeSummary, deleteBotRule, exportProduct, filterByField, goToPage, openLightbox, openProduct, sendDetailToTelegram, toggleBotRule, toggleRowSelection, filterBrandsList
});

function startCreatePreset() {
  const select = document.getElementById('filter-presets-selector');
  const nameInput = document.getElementById('preset-name-input');
  const cancelBtn = document.getElementById('cancel-preset-btn');

  state.oldPresetNameForRename = null;
  nameInput.value = '';

  select.style.display = 'none';
  const delBtn = document.getElementById('delete-preset-btn');
  if (delBtn) delBtn.style.display = 'none';
  const renBtn = document.getElementById('rename-preset-btn');
  if (renBtn) renBtn.style.display = 'none';
  const addBtn = document.getElementById('add-preset-btn');
  if (addBtn) addBtn.style.display = 'none';

  nameInput.style.display = 'inline-block';
  cancelBtn.style.display = 'flex';
  nameInput.focus();

  showToast("Escribe un nombre y dale al botón de Guardar.");
}

function startRenamePreset() {
  const select = document.getElementById('filter-presets-selector');
  const nameInput = document.getElementById('preset-name-input');
  const cancelBtn = document.getElementById('cancel-preset-btn');

  if (!select.value) return;

  state.oldPresetNameForRename = select.value;
  nameInput.value = select.value;

  select.style.display = 'none';
  const delBtn = document.getElementById('delete-preset-btn');
  if (delBtn) delBtn.style.display = 'none';
  const renBtn = document.getElementById('rename-preset-btn');
  if (renBtn) renBtn.style.display = 'none';
  const addBtn = document.getElementById('add-preset-btn');
  if (addBtn) addBtn.style.display = 'none';

  nameInput.style.display = 'inline-block';
  cancelBtn.style.display = 'flex';
  nameInput.focus();

  showToast("Modifica el nombre y dale al botón de Guardar.");
}

function cancelPresetSave() {
  const nameInput = document.getElementById('preset-name-input');
  const select = document.getElementById('filter-presets-selector');
  const cancelBtn = document.getElementById('cancel-preset-btn');
  const addBtn = document.getElementById('add-preset-btn');

  state.oldPresetNameForRename = null;
  nameInput.style.display = 'none';
  cancelBtn.style.display = 'none';
  select.style.display = 'inline-block';
  if (addBtn) addBtn.style.display = 'flex';
  nameInput.value = '';

  loadSelectedPreset();
}

async function saveFilters() {
  const nameInput = document.getElementById('preset-name-input');
  const select = document.getElementById('filter-presets-selector');
  const cancelBtn = document.getElementById('cancel-preset-btn');
  const addBtn = document.getElementById('add-preset-btn');

  let presetName = select.value;

  if (nameInput.style.display !== 'none' && nameInput.style.display !== '') {
    presetName = nameInput.value.trim();
    if (!presetName) {
      showToast("Debes escribir un nombre para guardar el preset.");
      nameInput.focus();
      return;
    }

    nameInput.style.display = 'none';
    cancelBtn.style.display = 'none';
    select.style.display = 'inline-block';
    if (addBtn) addBtn.style.display = 'flex';
    nameInput.value = '';
  }

  if (!presetName) return;

  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';

  let existingFilters = {};
  try {
    const fetchRes = await fetchAPI('/api/scraper/config'); if (!fetchRes) return;
    if (fetchRes.ok) {
      const data = await fetchRes.json();
      if (data && data.filters) {
        existingFilters = typeof data.filters === 'string' ? JSON.parse(data.filters) : data.filters;
      }
    }
  } catch (e) { }

  const currentFilters = {
    'local-filter': document.getElementById('local-filter').value,
    'filter-reference-address': document.getElementById('filter-reference-address') ? document.getElementById('filter-reference-address').value : '',
    'filter-distance-max': document.getElementById('filter-distance-max') ? document.getElementById('filter-distance-max').value : '',
    'filter-stock': document.getElementById('filter-stock') ? document.getElementById('filter-stock').value : '',
    'filter-category': document.getElementById('filter-category') ? document.getElementById('filter-category').value : '',
    'filter-rating': document.getElementById('filter-rating') ? document.getElementById('filter-rating').value : '',
    'filter-price-min': document.getElementById('filter-price-min') ? document.getElementById('filter-price-min').value : '',
    'filter-price-max': document.getElementById('filter-price-max') ? document.getElementById('filter-price-max').value : '',
    'filter-fluctuation': document.getElementById('filter-fluctuation') ? document.getElementById('filter-fluctuation').value : '',
    // Los filtros avanzados no se guardan en el preset (siempre por defecto)
    'filter-pets': '',
    'filter-parking': '',
    'filter-availability-date': ''
  };

  if (!existingFilters[target]) {
    existingFilters[target] = {};
  }

  // Auto-migrate old single-filter format
  if (existingFilters[target]['local-filter'] !== undefined) {
    existingFilters[target] = { "Predeterminado": existingFilters[target] };
  }

  if (state.oldPresetNameForRename && state.oldPresetNameForRename !== presetName) {
    if (existingFilters[target][state.oldPresetNameForRename]) {
      delete existingFilters[target][state.oldPresetNameForRename];
    }
  }

  existingFilters[target][presetName] = currentFilters;
  state.oldPresetNameForRename = null; // Reset rename state

  try {
    const res = await fetchAPI('/api/scraper/config', {
      method: 'POST',
      body: JSON.stringify({ filters: existingFilters })
    });
    if (!res) return;
    if (res.ok) {
      showToast(`Preset "${presetName}" guardado.`);
      await loadPresetsDropdown();
      document.getElementById('filter-presets-selector').value = presetName;
    } else throw new Error("Error al guardar configuración.");
  } catch (err) {
    showToast(err.message);
  }
}

// New function to just load the dropdown
async function loadPresetsDropdown() {
  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
  try {
    const fetchRes = await fetchAPI('/api/scraper/config'); if (!fetchRes) return;
    if (!fetchRes.ok) return;
    const data = await fetchRes.json();
    if (!data || !data.filters) return;
    let parsed = typeof data.filters === 'string' ? JSON.parse(data.filters) : data.filters;

    let targetFilters = parsed[target] || {};
    if (targetFilters['local-filter'] !== undefined) {
      targetFilters = { "Predeterminado": targetFilters };
    }

    if (!targetFilters['Predeterminado']) {
      targetFilters['Predeterminado'] = {};
    }

    setScraperPresets(targetFilters);

    const sel = document.getElementById('filter-presets-selector');
    sel.innerHTML = '';
    let hasPresets = false;
    for (const presetName in targetFilters) {
      const opt = document.createElement('option');
      opt.value = presetName;
      opt.textContent = presetName;
      sel.appendChild(opt);
      hasPresets = true;
    }

    if (!hasPresets) {
      sel.innerHTML = '<option value="" disabled>Sin presets</option>';
    } else {
      sel.value = 'Predeterminado';
      setTimeout(loadSelectedPreset, 0);
    }
  } catch (e) { }
}

async function loadSelectedPreset() {
  const presetName = document.getElementById('filter-presets-selector').value;
  const delBtn = document.getElementById('delete-preset-btn');
  const renBtn = document.getElementById('rename-preset-btn');

  if (!presetName) {
    if (delBtn) delBtn.style.display = 'none';
    if (renBtn) renBtn.style.display = 'none';
    resetFilters();
    return;
  }

  if (presetName === 'Predeterminado') {
    if (delBtn) delBtn.style.display = 'none';
    if (renBtn) renBtn.style.display = 'none';
  } else {
    if (delBtn) delBtn.style.display = 'flex';
    if (renBtn) renBtn.style.display = 'flex';
  }

  if (getScraperPresets()[presetName]) {
    applyFiltersToUI(getScraperPresets()[presetName]);
    showToast(`Preset "${presetName}" cargado.`);
  }
}

async function deleteSelectedPreset() {
  const presetName = document.getElementById('filter-presets-selector').value;
  if (!presetName) return;

  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
  let existingFilters = {};
  try {
    const fetchRes = await fetchAPI('/api/scraper/config'); if (!fetchRes) return;
    if (fetchRes.ok) {
      const data = await fetchRes.json();
      if (data && data.filters) {
        existingFilters = typeof data.filters === 'string' ? JSON.parse(data.filters) : data.filters;
      }
    }
  } catch (e) { }

  if (existingFilters[target] && existingFilters[target][presetName]) {
    delete existingFilters[target][presetName];

    try {
      const res = await fetchAPI('/api/scraper/config', {
        method: 'POST',
        body: JSON.stringify({ filters: existingFilters })
      });
      if (!res) return;
      if (res.ok) {
        showToast(`Preset "${presetName}" eliminado.`);
        await loadPresetsDropdown();
        document.getElementById('filter-presets-selector').value = '';
        document.getElementById('delete-preset-btn').style.display = 'none';
        resetFilters();
      } else throw new Error("Error al eliminar configuración.");
    } catch (err) {
      showToast(err.message);
    }
  }
}

function parseAvailabilityDate(desc) {
  if (!desc) return null;
  const match = desc.match(/(?:availability|disponibilit[eé]|disponibilidad)\s*[:|]?\s*([a-zA-Z0-9\/\s,]+)/i);
  if (!match) return null;
  let str = match[1].trim().toLowerCase();
  str = str.split('*')[0].trim();
  str = str.replace(/ \+.*/, '').trim();
  // Immediate / now
  if (str.includes('immediat') || str.includes('inmediat') || str === 'now' || str === 'immediately') {
    return new Date(0);
  }
  // "To be confirmed" / "à confirmer" / "a confirmar" → treat as available now
  if (/to be confirmed|to confirm|\bà confirmer\b|a confirmar|tbd|\bto be determined\b/i.test(str)) {
    return new Date();
  }
  // MM/DD/YYYY (atHome format)
  const mdMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdMatch) {
    return new Date(parseInt(mdMatch[3], 10), parseInt(mdMatch[1], 10) - 1, parseInt(mdMatch[2], 10));
  }
  // Month YYYY (english/french)
  const textMatch = str.match(/^([a-z]+)[\s,]+(\d{4})$/);
  if (textMatch) {
    const months = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11
    };
    const monthStr = textMatch[1].replace(/[eé]/g, 'e').replace(/û/g, 'u');
    const month = months[monthStr];
    if (month !== undefined) return new Date(parseInt(textMatch[2], 10), month, 1);
  }
  // Unrecognized string but a date field exists → treat as available now (don't exclude)
  return new Date();
}

function applyFiltersToUI(filtersObj) {
  resetFilters();

  for (const key in filtersObj) {
    if (key === 'filter-pets' || key === 'filter-parking' || key === 'filter-availability-date') {
      continue; // No cargar los filtros avanzados desde el preset
    }
    const el = document.getElementById(key);
    if (el) el.value = filtersObj[key];
  }
  filterTable();
}

async function loadFilters(silent = false) {
  const nameInput = document.getElementById('preset-name-input');
  if (nameInput && nameInput.style.display !== 'none') {
    const select = document.getElementById('filter-presets-selector');
    const cancelBtn = document.getElementById('cancel-preset-btn');
    const addBtn = document.getElementById('add-preset-btn');

    state.oldPresetNameForRename = null;
    nameInput.style.display = 'none';
    cancelBtn.style.display = 'none';
    select.style.display = 'inline-block';
    if (addBtn) addBtn.style.display = 'flex';
    nameInput.value = '';
  }

  await loadPresetsDropdown();

  const presetName = document.getElementById('filter-presets-selector').value;
  if (presetName) {
    await loadSelectedPreset();
  }

  if (!silent) showToast("Filtros y presets recargados.");
}

socket.on('scraper_state_update', (sockState) => {
  const loading = document.getElementById('loading');
  const btnRoutine = document.getElementById('btn-routine');

  if (sockState.is_scraping) {
    loading.style.display = 'flex';
    if (sockState.progress) {
      const p = sockState.progress;
      const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
      const loadingText = document.getElementById('loading-text');
      const barContainer = document.getElementById('progress-bar-container');
      const barFill = document.getElementById('progress-bar-fill');
      const progressDetail = document.getElementById('progress-detail');
      if (loadingText) loadingText.textContent = `Scrapeando... ${p.current}/${p.total}`;
      if (barContainer) barContainer.style.display = 'block';
      if (barFill) barFill.style.width = pct + '%';
      if (progressDetail) {
        const extra = p.products_found !== undefined ? ` · ${p.products_found} productos encontrados` : '';
        progressDetail.textContent = `Término: ${p.current_term}${extra}`;
      }
      if (p.current >= p.total) {
        loading.style.display = 'none';
      }
    } else if (sockState.user === SCRAPER_CONFIG.user) {
      const loadingText = document.getElementById('loading-text');
      if (loadingText) loadingText.textContent = 'Scraping iniciado por ti en segundo plano...';
    } else {
      const loadingText = document.getElementById('loading-text');
      if (loadingText) {
        if (!sockState.user || sockState.user === 'null' || sockState.user === 'None') {
          loadingText.textContent = `Scraping en curso...`;
        } else {
          loadingText.textContent = `Scraping en curso por ${sockState.user}...`;
        }
      }
    }
    if (btnRoutine) btnRoutine.disabled = true;
  } else {
    loading.style.display = 'none';
    if (btnRoutine) btnRoutine.disabled = false;
    if (typeof state.pollingInterval !== 'undefined' && state.pollingInterval) {
      clearInterval(state.pollingInterval);
    }
    if (sockState.distances_updated) {
      loadDatabase().then(() => sortByDistance(true));
    }
  }
});


socket.on('scraper_distance_update', (data) => {
  // Find in global allData to update
  if (typeof state.allData !== 'undefined') {
    const item = state.allData.find(d => d.sku === data.sku);
    if (item) {
      item.distance = data.distance;
    }
  }

  // Update DOM instantly if row exists and is visible
  const distEl = document.getElementById(`dist-${data.sku}`);
  if (distEl) {
    if (data.distance >= 999999) {
      distEl.textContent = 'N/A';
      distEl.style.color = 'var(--text-muted)';
    } else {
      distEl.innerHTML = `<span style="font-weight:bold; color:var(--primary);">${data.distance.toFixed(1)} km</span>`;
    }
  }

  // Re-apply filters every 500ms so new items pop into the view
  if (state.distanceUpdateTimeout) clearTimeout(state.distanceUpdateTimeout);
  state.distanceUpdateTimeout = setTimeout(() => {
    if (typeof filterTable === 'function') {
      filterTable();
    }
  }, 500);
});

if (localStorage.getItem('nv_theme') === 'light') {
  document.documentElement.setAttribute('data-theme', 'light');
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('theme-icon-sun').style.display = 'none';
    document.getElementById('theme-icon-moon').style.display = 'block';
  });
}

setInterval(async () => {
  try {
    await fetchAPI('/api/system/user/info');
  } catch (e) { }
}, 60000);

function onFluctuationChange() {
  const fluc = document.getElementById('filter-fluctuation').value;
  const sortBtn = document.getElementById('sort-fluctuation-btn');

  state.fluctuationSort = 'none';
  if (sortBtn) sortBtn.innerHTML = 'Ordenar: Por defecto';

  if (fluc) {
    sortBtn.style.display = 'block';
  } else {
    sortBtn.style.display = 'none';
  }
  filterTable();
}

function resetFilters() {
  const allFilters = [
    'local-filter', 'filter-stock', 'filter-category', 'filter-price-min',
    'filter-price-max', 'filter-fluctuation', 'filter-distance-max',
    'filter-pets', 'filter-parking', 'filter-availability-date'
  ];
  for (const id of allFilters) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  const rating = document.getElementById('filter-rating');
  if (rating) rating.value = '0';

  state.sortQueue = [{ field: 'last_updated', dir: -1 }];
  document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');

  onFluctuationChange();
}

function validatePriceRange() {
  const minInput = document.getElementById('filter-price-min');
  const maxInput = document.getElementById('filter-price-max');
  if (minInput.value !== '' && maxInput.value !== '') {
    const minVal = parseFloat(minInput.value);
    const maxVal = parseFloat(maxInput.value);
    if (minVal > maxVal) {
      minInput.value = maxVal;
      maxInput.value = minVal;
    }
  }
}

function cycleFluctuationSort() {
  const fluc = document.getElementById('filter-fluctuation').value;
  const sortBtn = document.getElementById('sort-fluctuation-btn');

  if (state.fluctuationSort === 'none') {
    if (fluc === 'rise_any') {
      state.fluctuationSort = 'rise_first';
      sortBtn.innerHTML = 'Ordenar: Mayor subida';
    } else {
      state.fluctuationSort = 'drop_first';
      sortBtn.innerHTML = 'Ordenar: Mayor bajada';
    }
  } else if (state.fluctuationSort === 'drop_first') {
    if (fluc === 'any') {
      state.fluctuationSort = 'rise_first';
      sortBtn.innerHTML = 'Ordenar: Mayor subida';
    } else {
      state.fluctuationSort = 'none';
      sortBtn.innerHTML = 'Ordenar: Por defecto';
    }
  } else if (state.fluctuationSort === 'rise_first') {
    state.fluctuationSort = 'none';
    sortBtn.innerHTML = 'Ordenar: Por defecto';
  }

  filterTable();
}





function bulkAction(action) {
  const skuArray = Array.from(state.selectedSkus);
  if (skuArray.length === 0) return;

  if (action === 'favorite') {
    skuArray.forEach(sku => {
      if (!state.favorites.includes(sku)) state.favorites.push(sku);
      if (state.discarded.includes(sku)) state.discarded = state.discarded.filter(id => id !== sku);
    });
  } else if (action === 'discard') {
    skuArray.forEach(sku => {
      if (!state.discarded.includes(sku)) state.discarded.push(sku);
      if (state.favorites.includes(sku)) state.favorites = state.favorites.filter(id => id !== sku);
    });
  } else if (action === 'restore') {
    skuArray.forEach(sku => {
      if (state.discarded.includes(sku)) state.discarded = state.discarded.filter(id => id !== sku);
      if (state.favorites.includes(sku)) state.favorites = state.favorites.filter(id => id !== sku);
    });
  }
  saveFavorites();
  saveDiscarded();

  state.selectedSkus.clear();
  updateBulkActionBar();
  filterTable();
}

function toggleFavorite(sku, e) {
  sku = String(sku);
  if (e) e.stopPropagation();
  if (state.favorites.includes(sku)) {
    state.favorites = state.favorites.filter(id => id !== sku);
  } else {
    state.favorites.push(sku);
    if (state.discarded.includes(sku)) {
      state.discarded = state.discarded.filter(id => id !== sku);
      saveDiscarded();
    }
  }
  saveFavorites();
  filterTable();
  updateDetailButtons(sku);
}

function toggleDiscarded(sku, e) {
  sku = String(sku);
  if (e) e.stopPropagation();
  if (state.discarded.includes(sku)) {
    state.discarded = state.discarded.filter(id => id !== sku);
  } else {
    state.discarded.push(sku);
    if (state.favorites.includes(sku)) {
      state.favorites = state.favorites.filter(id => id !== sku);
      saveFavorites();
    }
  }
  saveDiscarded();
  filterTable();
  updateDetailButtons(sku);
}

window.addEventListener('beforeunload', function (e) {
  if (typeof state.isBatchScrapingDescriptions !== 'undefined' && state.isBatchScrapingDescriptions) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function showDiscarded() {
  if (typeof state.isBatchScrapingDescriptions !== 'undefined' && state.isBatchScrapingDescriptions) {
    alert("Por favor, cancela o espera a que termine la extracción profunda (Fase 2) antes de cambiar de vista.");
    return;
  }
  state.filterDiscardedOnly = !state.filterDiscardedOnly;
  state.filterFavsOnly = false;
  closeProductView();
  closeConfigView();
  const discMenuBtn = document.getElementById('nav-discarded-btn');
  const favMenuBtn = document.getElementById('nav-fav-btn');
  if (favMenuBtn) {
    favMenuBtn.style.background = 'transparent';
    favMenuBtn.style.color = 'var(--text-sub)';
  }
  if (state.filterDiscardedOnly) {
    discMenuBtn.style.background = 'rgba(248, 113, 113, 0.15)';
    discMenuBtn.style.color = '#f87171';
  } else {
    discMenuBtn.style.background = 'transparent';
    discMenuBtn.style.color = 'var(--text-sub)';
  }
  filterTable();
}

function showFavorites() {
  if (typeof state.isBatchScrapingDescriptions !== 'undefined' && state.isBatchScrapingDescriptions) {
    alert("Por favor, cancela o espera a que termine la extracción profunda (Fase 2) antes de cambiar de vista.");
    return;
  }
  state.filterFavsOnly = !state.filterFavsOnly;
  state.filterDiscardedOnly = false;
  closeProductView();
  closeConfigView();
  const favMenuBtn = document.getElementById('nav-fav-btn');
  const discMenuBtn = document.getElementById('nav-discarded-btn');
  if (discMenuBtn) {
    discMenuBtn.style.background = 'transparent';
    discMenuBtn.style.color = 'var(--text-sub)';
  }
  if (state.filterFavsOnly) {
    favMenuBtn.style.background = 'rgba(99, 102, 241, 0.15)';
    favMenuBtn.style.color = 'var(--text-main)';
  } else {
    favMenuBtn.style.background = 'transparent';
    favMenuBtn.style.color = 'var(--text-sub)';
  }
  filterTable();
}

function showAllProducts() {
  if (typeof state.isBatchScrapingDescriptions !== 'undefined' && state.isBatchScrapingDescriptions) {
    alert("Por favor, cancela o espera a que termine la extracción profunda (Fase 2) antes de cambiar de vista.");
    return;
  }
  state.filterFavsOnly = false;
  state.filterDiscardedOnly = false;
  document.getElementById('local-filter').value = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-stock').value = '';
  document.getElementById('filter-fluctuation').value = '';
  onFluctuationChange();
  document.getElementById('filter-rating').value = '0';
  document.getElementById('filter-price-min').value = '';
  document.getElementById('filter-price-max').value = '';

  const favMenuBtn = document.getElementById('nav-fav-btn');
  if (favMenuBtn) {
    favMenuBtn.style.background = 'transparent';
    favMenuBtn.style.color = 'var(--text-sub)';
  }
  const discMenuBtn = document.getElementById('nav-discarded-btn');
  if (discMenuBtn) {
    discMenuBtn.style.background = 'transparent';
    discMenuBtn.style.color = 'var(--text-sub)';
  }

  closeProductView();
  closeConfigView();

  state.sortQueue = [{ field: 'last_updated', dir: -1 }];
  document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');

  filterTable();
}

function sortTable(field, event) {
  const existingIdx = state.sortQueue.findIndex(s => s.field === field);

  // Ctrl+Click: quitar columna del sort
  if (event && (event.ctrlKey || event.metaKey)) {
    if (existingIdx !== -1) state.sortQueue.splice(existingIdx, 1);
    if (state.sortQueue.length === 0) state.sortQueue = [{ field: 'last_updated', dir: -1 }];
  } else if (existingIdx !== -1) {
    const item = state.sortQueue[existingIdx];
    if (item.dir === 1) {
      // Segunda vez: invertir dirección
      item.dir = -1;
    } else {
      // Tercera vez (ya era desc): quitar columna
      state.sortQueue.splice(existingIdx, 1);
      if (state.sortQueue.length === 0) state.sortQueue = [{ field: 'last_updated', dir: -1 }];
    }
    // Moverla al frente si no lo estaba ya
    if (existingIdx !== 0 && state.sortQueue.includes(item)) {
      state.sortQueue.splice(state.sortQueue.indexOf(item), 1);
      state.sortQueue.unshift(item);
    }
  } else {
    // Nueva columna: añadir al frente ascendente
    state.sortQueue.unshift({ field, dir: 1 });
    if (state.sortQueue.length > 3) state.sortQueue.pop();
  }

  // Actualizar iconos
  document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');
  state.sortQueue.forEach((sort, idx) => {
    const icon = document.getElementById('sort-icon-' + sort.field);
    if (icon) {
      const arrow = sort.dir === 1 ? '↑' : '↓';
      const num = state.sortQueue.length > 1 ? `${idx + 1}` : '';
      const opacity = idx === 0 ? '1' : (idx === 1 ? '0.7' : '0.4');
      icon.innerHTML = `<span style="opacity:${opacity}; font-size:0.85em; font-weight:bold;" title="Click: invertir | 3º click: quitar"> ${num}${arrow}</span>`;
    }
  });

  filterTable();
}



document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-collapsible') && !e.target.closest('.sub-list')) {
    document.querySelectorAll('.sub-list').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.chevron').forEach(el => el.style.transform = 'rotate(0deg)');
  }

  const userMenu = document.getElementById('user-menu');
  if (userMenu && userMenu.classList.contains('show') && !e.target.closest('#sidebar-user-btn') && !e.target.closest('#user-menu')) {
    userMenu.classList.remove('show');
  }
});

function filterByField(value) {
  const catSelect = document.getElementById('filter-category');
  let foundCategory = false;
  if (catSelect) {
    for (let i = 0; i < catSelect.options.length; i++) {
      if (catSelect.options[i].value === value) {
        catSelect.value = value;
        foundCategory = true;
        break;
      }
    }
  }
  if (foundCategory) {
    document.getElementById('local-filter').value = '';
  } else {
    document.getElementById('local-filter').value = value;
  }
  filterTable();
}


// --- NUEVO: Inicialización de caché asíncrona desde el servidor de Docker ---

async function loadGeocodeCacheFromServer() {
  try {
    const res = await fetchAPI('/api/scraper/geocode/cache'); if (!res) return;
    if (res.ok) {
      state.locationCoordsCache = await res.json();
    }
  } catch (e) { console.error('Error cargando caché de coordenadas:', e); }
}

async function geocode(address) {
  if (!address) return null;

  // --- CORREGIDO: Limpiamos espacios en blanco al inicio y al final ---
  const cleanAddress = address.trim();

  // Si ya está en la caché en memoria, la devolvemos del tirón
  if (state.locationCoordsCache[cleanAddress]) return state.locationCoordsCache[cleanAddress];

  let query = cleanAddress;

  // --- MEJORADO: Expresión regular insensible a espacios finales ---
  const countryMatch = cleanAddress.match(/\(([A-Z]{2})\)\s*$/i);
  if (countryMatch) {
    const countryCode = countryMatch[1].toUpperCase();
    const cityPart = cleanAddress.replace(/\s*\([A-Z]{2}\)\s*$/i, '').trim();
    const countryNames = { 'FR': 'France', 'LU': 'Luxembourg', 'BE': 'Belgium', 'DE': 'Germany' };
    query = `${cityPart}, ${countryNames[countryCode] || countryCode}`;
  } else {
    const hasCountry = /luxembourg|france|belgium|deutschland|allemagne|\d{4,5}/i.test(cleanAddress);
    if (!hasCountry) query = cleanAddress + ', Luxembourg';
  }

  async function tryPhoton(q) {
    try {
      const res = await fetchAPI(`/api/scraper/geocode?q=${encodeURIComponent(q)}`); if (!res) return null;
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.found) {
        return { lat: data.lat, lon: data.lon };
      }
    } catch (e) { console.error('[geocode proxy]', q, e); }
    return null;
  }

  let coords = await tryPhoton(query);

  if (!coords) {
    const fallback = query.replace(/^[^,]+,\s*/, '');
    // Evitar que el fallback sea solo el nombre del país, ya que eso geolocaliza el centro de Francia/Luxemburgo
    if (fallback && fallback !== query && !/^(France|Luxembourg|Belgium|Germany)$/i.test(fallback)) {
      coords = await tryPhoton(fallback);
    }
  }

  if (coords) {
    state.locationCoordsCache[cleanAddress] = coords;
    try { localStorage.setItem('nv_geocode_cache_v3', JSON.stringify(state.locationCoordsCache)); } catch (e) { }
    // --- NUEVO: Guardado persistente en el archivo físico del servidor ---
    try {
      fetchAPI('/api/scraper/geocode/cache', {
        method: 'POST',
        body: JSON.stringify({ [cleanAddress]: coords })
      });
    } catch (e) { console.error('Error enviando coordenada al servidor:', e); }
  }
  return coords || null;
}




function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function saveScraperRef(ref) {
  try {
    await fetchAPI('/api/scraper/config', {
      method: 'POST',
      body: JSON.stringify({ scraper_ref: ref })
    });
  } catch (e) { console.error('Error saving ref:', e); }
}


async function sortByDistance(silent = false, forceRecalculate = false) {
  if (state.isSortingByDistance) {
    if (!forceRecalculate) return;
    state.cancelSortCounter++;
  }

  const currentSortId = state.cancelSortCounter;
  state.isSortingByDistance = true;
  try {
    const refAddress = document.getElementById('filter-reference-address')?.value?.trim();
    const btn = document.querySelector('#distance-filter-container button');
    const originalText = btn ? (btn.dataset.originalText || 'Calcular') : 'Calcular';
    if (btn && !btn.dataset.originalText) btn.dataset.originalText = originalText;

    if (forceRecalculate) {
      if (!refAddress) {
        if (!silent) alert('Por favor, ingresa una dirección de referencia.');
        return;
      }
      if (!silent && btn) {
        btn.textContent = 'Calculando...';
        btn.disabled = true;
      }

      try {
        await fetchAPI('/api/scraper/config/reference', {
          method: 'POST',
          body: JSON.stringify({ address: refAddress })
        });
        // El backend iniciará recalculate_distances() y emitirá scraper_state_update
        // con distances_updated=true cuando termine, lo cual llamará a loadData() y sortByDistance(true).
      } catch (e) {
        console.error('Error triggering distance recalculation:', e);
        if (btn) {
          btn.textContent = originalText;
          btn.disabled = false;
        }
      }
      return; // Detenemos aquí, la recarga se hará por WebSocket
    }

    // --- SORTING PHASE (Distances already in allData from backend) ---
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }

    for (let p of state.allData) {
      if (!p.distance && p.distance !== 0) {
        p.distance = 999999;
      }
    }

    const distSortIdx = state.sortQueue.findIndex(s => s.field === 'distance');
    if (distSortIdx !== -1) {
      state.sortQueue.splice(distSortIdx, 1);
    }
    state.sortQueue.unshift({ field: 'distance', dir: 1 });
    if (state.sortQueue.length > 3) state.sortQueue.pop();

    document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');
    state.sortQueue.forEach((sort, idx) => {
      const icon = document.getElementById('sort-icon-' + sort.field);
      if (icon) {
        let arrow = sort.dir === 1 ? '↑' : '↓';
        let num = state.sortQueue.length > 1 ? `${idx + 1}` : '';
        let opacity = idx === 0 ? '1' : (idx === 1 ? '0.7' : '0.4');
        icon.innerHTML = `<span style="opacity:${opacity}; font-size:0.85em; font-weight:bold;"> ${num}${arrow}</span>`;
      }
    });

    filterTable(true);
  } finally {
    if (currentSortId === state.cancelSortCounter) {
      state.isSortingByDistance = false;
    }
  }
}

function filterTable(preservePage = false) {
  const query = document.getElementById('local-filter').value.toLowerCase();
  const category = document.getElementById('filter-category').value;
  const stock = document.getElementById('filter-stock').value;
  const fluctuation = document.getElementById('filter-fluctuation').value;
  const minRating = parseFloat(document.getElementById('filter-rating').value) || 0;
  const minPrice = parseFloat(document.getElementById('filter-price-min').value);
  const maxPrice = parseFloat(document.getElementById('filter-price-max').value);

  const petsPolicy = document.getElementById('filter-pets')?.value;
  const parking = document.getElementById('filter-parking')?.value;
  const availabilityDateStr = document.getElementById('filter-availability-date')?.value;
  let availabilityDate = null;
  if (availabilityDateStr) {
    availabilityDate = new Date(availabilityDateStr);
  }

  const filtered = state.allData.filter(p => {
    const pSkuStr = String(p.sku);
    if (state.filterFavsOnly && !state.favorites.includes(pSkuStr)) return false;
    if (state.filterDiscardedOnly && !state.discarded.includes(pSkuStr)) return false;
    if (!state.filterDiscardedOnly && !state.filterFavsOnly && state.discarded.includes(pSkuStr)) return false;

    if (fluctuation) {
      if (!p.prev_price || p.prev_price === p.price) return false;

      const diff = p.price - p.prev_price;
      const pct = (diff / p.prev_price) * 100;

      if (fluctuation === 'drop_any' && diff >= 0) return false;
      if (fluctuation === 'rise_any' && diff <= 0) return false;
    }
    if (query && !(
      (p.title && p.title.toLowerCase().includes(query)) ||
      (p.brand && p.brand.toLowerCase().includes(query)) ||
      (p.category && p.category.toLowerCase().includes(query))
    )) return false;
    if (category && p.category !== category) return false;
    if (stock) {
      const tgt = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
      if (tgt === 'athome') {
        const isSoldByPrice = p.price === 0;
        const isSoldByAvailability = p.availability === 'Agotado';
        const isSold = isSoldByPrice || isSoldByAvailability;

        if (stock === 'in_stock' && isSold) return false;
        if (stock === 'out_of_stock' && !isSold) return false;
      } else {
        const inStock = p.availability && p.availability.includes('InStock');
        if (stock === 'in_stock' && !inStock) return false;
        if (stock === 'out_of_stock' && inStock) return false;
      }
    }
    if (minRating > 0 && (p.rating_value || 0) < minRating) return false;
    if (!isNaN(minPrice) && (p.price || 0) < minPrice) return false;
    const maxDist = parseFloat(document.getElementById('filter-distance-max').value);
    const currentTarget = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
    if (!isNaN(maxDist) && maxDist > 0 && (p.distance === undefined || p.distance === 999999 || p.distance > maxDist)) return false;
    if (!isNaN(maxPrice) && (p.price || 0) > maxPrice) return false;

    // Filtro: Mascotas, Parking y Disponibilidad (requiere descripción extraída vía batch scrape)
    if (petsPolicy || parking || availabilityDate) {
      if (!p.description_text) return true; // Let it pass so it can be scraped in Phase 2
      const desc = p.description_text.toLowerCase();

      if (availabilityDate) {
        const parsedPropDate = parseAvailabilityDate(desc);
        if (!parsedPropDate) return false;
        if (parsedPropDate > availabilityDate) return false;
      }

      if (petsPolicy === 'pets_allowed') {
        if (!desc.match(/\b(mascotas?|pets?|perros?|dogs?|gatos?|cats?|animal|animaux|chiens?|hunde?|katzen?|haustiere?)\b/i)) return false;
        if (desc.match(/\b(no mascotas?|no pets?|no se admiten|mascotas no|no perros?|sin mascotas?|sans animaux|pas d'animaux|interdits?|keine haustiere|pets? not allowed|pets? are not allowed|pets? and .*?not allowed|pets? not permitted|pets? are not permitted|pets? not accepted|pets? are not accepted|animaux non acceptés|no animals?|animaux ne sont pas admis|ne sont pas admis)\b/i)) return false;
      } else if (petsPolicy === 'no_pets') {
        if (desc.match(/\b(mascotas?|pets?|perros?|dogs?|gatos?|cats?|animal|animaux|chiens?|hunde?|katzen?|haustiere?)\b/i) && !desc.match(/\b(no mascotas?|no pets?|no se admiten|mascotas no|no perros?|sin mascotas?|sans animaux|pas d'animaux|interdits?|keine haustiere|pets? not allowed|pets? are not allowed|pets? and .*?not allowed|pets? not permitted|pets? are not permitted|pets? not accepted|pets? are not accepted|animaux non acceptés|no animals?|animaux ne sont pas admis|ne sont pas admis)\b/i)) return false;
      }

      if (parking === 'has_parking') {
        if (!desc.match(/(parking|garage|garaje|estacionamiento|stationnement|parkplatz|stellplatz)/i)) return false;
        if (desc.match(/(no parking|sin parking|sin garaje|no garage|sans parking|pas de parking|sans garage|kein parkplatz)/i)) return false;
      } else if (parking === 'no_parking') {
        if (desc.match(/(parking|garage|garaje|estacionamiento|stationnement|parkplatz|stellplatz)/i) && !desc.match(/(no parking|sin parking|sin garaje|no garage|sans parking|pas de parking|sans garage|kein parkplatz)/i)) return false;
      }
    }

    return true;
  });

  filtered.sort((a, b) => {
    if (state.fluctuationSort !== 'none') {
      const diffA = a.prev_price && a.price !== a.prev_price ? ((a.price - a.prev_price) / a.prev_price) : 0;
      const diffB = b.prev_price && b.price !== b.prev_price ? ((b.price - b.prev_price) / b.prev_price) : 0;
      if (state.fluctuationSort === 'drop_first') {
        if (diffA !== diffB) return diffA - diffB;
      } else if (state.fluctuationSort === 'rise_first') {
        if (diffA !== diffB) return diffB - diffA;
      }
    }

    for (let sort of state.sortQueue) {
      let valA = a[sort.field] || '';
      let valB = b[sort.field] || '';

      if (sort.field === 'price' || sort.field === 'rating_value' || sort.field === 'last_updated' || sort.field === 'distance') {
        valA = parseFloat(valA) || 0;
        valB = parseFloat(valB) || 0;
      } else {
        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();
      }

      if (valA < valB) return -1 * sort.dir;
      if (valA > valB) return 1 * sort.dir;
    }
    return 0;
  });

  if (!preservePage) {
    state.page = 1;
  } else {
    const totalPages = Math.max(1, Math.ceil(filtered.length / (state.PAGE_SIZE || 9)));
    state.page = Math.min(state.page || 1, totalPages);
  }

  state.PAGE_SIZE = 9;
  state.filteredData = filtered;
  state.isFiltered = query || category || stock || fluctuation || minRating > 0 || !isNaN(minPrice) || !isNaN(maxPrice);

  renderTable(filtered, state.isFiltered);
}




async function loadDatabase(isPolling = false) {
  try {
    const saved = localStorage.getItem('nv_geocode_cache_v3');
    if (saved) state.locationCoordsCache = JSON.parse(saved);
  } catch (e) { }
  try {
    const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
    const targetChanged = (state.currentTargetContext !== target);
    state.currentTargetContext = target;

    const timestamp = new Date().getTime();
    const res = await fetchAPI(`/api/scraper/data?type=${target}&_t=${timestamp}`);
    if (!res) return;
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const garbageBrands = ['pccom', 'tempest', 'forgeon', 'alurin', 'epical-q', 'l-link', 'nfortec', 'coolbox', 'hiditec', 'unyka', 'unykach', 'mars gaming', 'tacens'];

    // Reset filter values if target changed to prevent applying old filters to new data
    if (targetChanged) {
      const els = ['local-filter', 'filter-stock', 'filter-price-min', 'filter-price-max', 'filter-fluctuation', 'filter-category', 'filter-distance-max'];
      els.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const fr = document.getElementById('filter-rating'); if (fr) fr.value = '0';
    }

    // Update UI based on target
    const pageSub = document.querySelector('.page-sub');

    const lblBrands = document.getElementById('lbl-brands');
    const lblCategories = document.getElementById('lbl-categories');
    const thTitle = document.getElementById('th-title');
    const thBrand = document.getElementById('th-brand');
    const thCategory = document.getElementById('th-category');
    const thRating = document.getElementById('th-rating');

    const filterStock = document.getElementById('filter-stock');
    const filterRating = document.getElementById('filter-rating');
    const distContainer = document.getElementById('distance-filter-container');
    const localFilter = document.getElementById('local-filter');
    const filterPets = document.getElementById('filter-pets');
    const filterParking = document.getElementById('filter-parking');
    const filterAvailabilityContainer = document.getElementById('filter-availability-container');
    const filterSection3Athome = document.getElementById('filter-section-3-athome');
    const filterSection3Pccomp = document.getElementById('filter-section-3-pccomp');
    const filterSection2 = document.getElementById('filter-section-2');

    const thDistanceCol = document.getElementById('th-distance-col');

    const savedTerms = localStorage.getItem('nv_pccomp_terms') || '';
    const termsAreaSidebar = document.getElementById('config-pccomp-terms');
    if (termsAreaSidebar) {
      termsAreaSidebar.value = savedTerms;
    }

    if (target === 'athome') {
      if (distContainer) distContainer.style.display = 'block';
      if (thDistanceCol) thDistanceCol.style.display = 'table-cell';

      if (pageSub) pageSub.textContent = 'Scraper atHome.lu';
      if (lblBrands) lblBrands.textContent = 'Agencias';
      if (lblCategories) lblCategories.textContent = 'Inmuebles';
      if (thTitle) thTitle.textContent = 'Inmueble';
      if (thBrand) thBrand.textContent = 'Agencia';
      if (thCategory) thCategory.textContent = 'Tipo';
      if (thRating) thRating.textContent = 'Info';
      if (localFilter) localFilter.placeholder = 'Buscar por zona, agencia, etc...';
      if (filterStock) filterStock.style.display = 'inline-block';

      if (filterAvailabilityContainer) filterAvailabilityContainer.style.display = 'flex';
      if (filterSection3Athome) filterSection3Athome.style.display = '';
      if (filterSection3Pccomp) filterSection3Pccomp.style.display = 'none';
      if (filterSection2) filterSection2.style.display = '';

      if (filterRating) filterRating.innerHTML = '<option value="0">Cualquier tamaño</option><option value="40">Más de 40 m²</option><option value="60">Más de 60 m²</option><option value="100">Más de 100 m²</option>';

      if (!isPolling) {
        setTimeout(async () => {
          try {
            const cfgRes = await fetchAPI('/api/scraper/config'); if (!cfgRes) return;
            if (cfgRes.ok) {
              const config = await cfgRes.json();
              const savedRef = config.scraper_ref;
              const refInput = document.getElementById('filter-reference-address');
              if (savedRef && refInput) {
                refInput.value = savedRef;
                if (state.allData && state.allData.length > 0) {
                  sortByDistance();
                }
              }
            }
          } catch (e) { console.error('Error fetching config:', e); }
        }, 100);
      } else {
        const refInput = document.getElementById('filter-reference-address');
        if (refInput && refInput.value.trim() && state.allData && state.allData.length > 0) {
          sortByDistance(true);
        }
      }
    } else {
      if (pageSub) pageSub.textContent = 'Scraper PcComponentes';
      if (thDistanceCol) thDistanceCol.style.display = 'none';

      if (lblBrands) lblBrands.textContent = 'Marcas';
      if (lblCategories) lblCategories.textContent = 'Categorías';
      if (thTitle) thTitle.textContent = 'Componente';
      if (thBrand) thBrand.textContent = 'Marca';
      if (thCategory) thCategory.textContent = 'Categoría';
      if (thRating) thRating.textContent = 'Valoración';
      if (localFilter) localFilter.placeholder = 'Buscar modelo, marca, categoría...';
      if (distContainer) distContainer.style.display = 'none';

      if (filterAvailabilityContainer) filterAvailabilityContainer.style.display = 'none';
      if (filterSection3Athome) filterSection3Athome.style.display = 'none';
      if (filterSection3Pccomp) filterSection3Pccomp.style.display = '';
      if (filterSection2) filterSection2.style.display = 'none';

      if (filterStock) {
        filterStock.style.display = '';
        filterStock.innerHTML = '<option value="">Cualquier stock</option><option value="in_stock">En stock</option><option value="out_of_stock">Sin stock</option>';
      }
      if (filterRating) filterRating.innerHTML = '<option value="0">Cualquier valoración</option><option value="3">★ 3.0 o más</option><option value="4">★ 4.0 o más</option><option value="4.5">★ 4.5 o más</option>';
    }

    state.allData = data.filter(p => {
      if (p.brand && garbageBrands.includes(p.brand.toLowerCase().trim())) return false;
      if (target === 'athome') {
        return p.query_origin && p.query_origin.toLowerCase().includes('athome');
      } else {
        return !p.query_origin || !p.query_origin.toLowerCase().includes('athome');
      }
    });
    filterTable(true);

    const catMap = {};
    const brandsMap = {};

    if (state.allData && state.allData.length > 0) {
      state.allData.forEach(p => {
        if (p.brand) brandsMap[p.brand] = (brandsMap[p.brand] || 0) + 1;
        if (p.category) catMap[p.category] = (catMap[p.category] || 0) + 1;
      });
    }

    if (!isPolling) {
      const sortedBrands = Object.entries(brandsMap).sort((a, b) => b[1] - a[1]);
      document.getElementById('badge-brands').textContent = sortedBrands.length;
      document.getElementById('list-brands').innerHTML = sortedBrands.length === 0 ?
        '<div style="padding:10px;text-align:center;color:var(--text-sub);font-size:0.8rem;">No hay registradas</div>' :
        `<div style="position: sticky; top: -8px; margin: -8px -8px 8px -8px; background: var(--bg-card); padding: 8px; z-index: 10; border-bottom: 1px solid var(--border-color); border-radius: 12px 12px 0 0;"><input type="text" id="search-brands" class="search-input" placeholder="Buscar..." style="width: 100%; box-sizing: border-box;" oninput="filterBrandsList()"></div>` +
        sortedBrands.map(([b, c]) =>
          `<div class="sub-item brand-item" onclick="filterByField('${b}')"><span>${b}</span><span style="opacity:0.5">${c}</span></div>`
        ).join('');

      const sortedCat = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      document.getElementById('badge-categories').textContent = sortedCat.length;
      document.getElementById('list-categories').innerHTML = sortedCat.length === 0 ?
        '<div style="padding:10px;text-align:center;color:var(--text-sub);font-size:0.8rem;">No hay registradas</div>' :
        sortedCat.map(([c, count]) =>
          `<div class="sub-item" onclick="filterByField('${c}')"><span>${c}</span><span style="opacity:0.5">${count}</span></div>`
        ).join('');

      const catSelect = document.getElementById('filter-category');
      if (catSelect) {
        const currentVal = catSelect.value;
        const defText = target === 'athome' ? 'Cualquier Tipo' : 'Todas las categorías';
        catSelect.innerHTML = `<option value="">${defText}</option>` +
          sortedCat.map(([c, count]) => `<option value="${c}">${c}</option>`).join('');
        catSelect.value = currentVal;
      }
    }
  } catch (err) {
    document.getElementById('db-body').innerHTML = `<tr class="empty-row"><td colspan="7" style="color:#f87171;">Error: ${err.message}</td></tr>`;
  }
}


async function startScrape() {
  const termsRaw = document.getElementById('config-pccomp-terms').value.trim();
  if (!termsRaw) { showToast("Escribe al menos un término para scrapear."); return; }

  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';

  if (target === 'athome') {
    const query = termsRaw.split('\n')[0].trim();
    if (!query) return;
    socket.emit('set_scraper_state', { is_scraping: true, user: SCRAPER_CONFIG.user, type: 'search' });
    const loading = document.getElementById('loading');
    loading.style.display = 'flex';
    document.getElementById('loading-text').textContent = 'Scraping de atHome iniciado...';
    document.getElementById('progress-bar-container').style.display = 'none';
    document.getElementById('progress-detail').textContent = '';
    try {
      const res = await fetchAPI('/api/scraper/athome/search', {
        method: 'POST',
        body: JSON.stringify({ query })
      });
      if (!res) {
        document.getElementById('loading').style.display = 'none';
        socket.emit('set_scraper_state', { is_scraping: false });
        showToast("Error de autenticación o conexión al iniciar scraping.");
        return;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      _startPolling(300, 2000);
    } catch (err) {
      console.error("[Scraper API] Error al iniciar scrape:", err.message);
      document.getElementById('loading').style.display = 'none';
      socket.emit('set_scraper_state', { is_scraping: false });
    }
    return;
  }

  const terms = termsRaw.split('\n').map(t => t.trim()).filter(t => t);
  if (terms.length === 0) { showToast("Escribe al menos un término para scrapear."); return; }

  const loading = document.getElementById('loading');
  const barContainer = document.getElementById('progress-bar-container');
  const barFill = document.getElementById('progress-bar-fill');
  const loadingText = document.getElementById('loading-text');
  const progressDetail = document.getElementById('progress-detail');

  loading.style.display = 'flex';
  barContainer.style.display = 'block';
  barFill.style.width = '0%';
  loadingText.textContent = `Scrapeando ${terms.length} término${terms.length > 1 ? 's' : ''}...`;
  progressDetail.textContent = 'Iniciando...';

  state._scrapeProgressTotal = terms.length;
  state._scrapeProgressProducts = 0;

  try {
    const res = await fetchAPI('/api/scraper/pccomponentes/scrape', {
      method: 'POST',
      body: JSON.stringify({ terms })
    });
    if (!res) {
      loading.style.display = 'none';
      socket.emit('set_scraper_state', { is_scraping: false });
      showToast("Error de autenticación o conexión al iniciar scraping.");
      return;
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    _startPolling(3600, 3000);
  } catch (err) {
    console.error("[Scraper API] Error al iniciar scrape:", err.message);
    loading.style.display = 'none';
    socket.emit('set_scraper_state', { is_scraping: false });
  }
}

function _startPolling(maxPolls, intervalMs) {
  const loading = document.getElementById('loading');
  const btnCancel = document.getElementById('btn-cancel-routine');
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  let polls = 0;
  state.pollingInterval = setInterval(() => {
    loadDatabase(true);
    polls++;
    if (polls > maxPolls) {
      clearInterval(state.pollingInterval);
      loading.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      socket.emit('set_scraper_state', { is_scraping: false });
    }
  }, intervalMs);
}

async function startRoutine() {
  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
  let apiUrl = '/api/scraper/pccomponentes/routine';
  if (target === 'athome') apiUrl = '/api/scraper/athome/routine';

  let payload = {};
  if (target === 'pccomponentes') {
    const termsStr = localStorage.getItem('nv_pccomp_terms') || '';
    const terms = termsStr.split('\n').map(t => t.trim()).filter(t => t);
    if (terms.length === 0) {
      showToast("Debes configurar términos de búsqueda en Ajustes primero.");
      return;
    }
    payload = { terms: terms };
  }

  socket.emit('set_scraper_state', { is_scraping: true, user: SCRAPER_CONFIG.user, type: 'routine' });

  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  loading.innerHTML = '<span class="spin">↻</span> Rutina de extracción masiva iniciada (puede tardar unos minutos)...';

  const btnCancel = document.getElementById('btn-cancel-routine');
  if (btnCancel) btnCancel.style.display = 'inline-flex';

  try {
    const res = await fetchAPI(apiUrl, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!res) {
      loading.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
      socket.emit('set_scraper_state', { is_scraping: false });
      showToast("Error de autenticación o conexión al iniciar rutina.");
      return;
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (state.pollingInterval) clearInterval(state.pollingInterval);
    let polls = 0;
    state.pollingInterval = setInterval(() => {
      loadDatabase(true);
      polls++;
      if (polls > 3600) { // 3 horas de polling máximo
        clearInterval(state.pollingInterval);
        loading.style.display = 'none';
        if (btnCancel) btnCancel.style.display = 'none';
        socket.emit('set_scraper_state', { is_scraping: false });
      }
    }, 3000);
  } catch (err) {
    console.error("[Scraper API] Error al iniciar la rutina:", err.message);
    loading.style.display = 'none';
    if (btnCancel) btnCancel.style.display = 'none';
    socket.emit('set_scraper_state', { is_scraping: false });
  }
}

async function cancelRoutine() {
  try {
    const res = await fetchAPI('/api/scraper/cancel', {
      method: 'POST'
    });
    if (!res) {
      showToast("Error de autenticación o conexión al cancelar rutina.");
      return;
    }

    const loading = document.getElementById('loading');
    loading.style.display = 'none';
    const btnCancel = document.getElementById('btn-cancel-routine');
    if (btnCancel) btnCancel.style.display = 'none';

    if (state.pollingInterval) clearInterval(state.pollingInterval);
    socket.emit('set_scraper_state', { is_scraping: false });
    alert("La rutina se cancelará en breve. (Puede tardar unos segundos en soltar el navegador actual).");
  } catch (err) {
    console.error("[Scraper API] Error al cancelar:", err);
    showToast("Error de red al cancelar rutina.");
  }
}

async function exportProduct() {
  if (!state.currentProductSku) return;
  try {
    const res = await fetchAPI('/api/scraper/export', {
      method: 'POST',
      body: JSON.stringify({ sku: state.currentProductSku })
    });
    if (!res) return;
    const data = await res.json();
    if (data.error) {
      showToast('Error: ' + data.error);
    } else {
      showToast('Guardado correctamente en favourites/');
    }
  } catch (e) {
    showToast('Error al guardar: ' + e.message);
  }
}



async function saveConfig() {
  const selected = document.querySelector('input[name="scraper-target"]:checked');
  if (selected) {
    localStorage.setItem('nv_scraper_target', selected.value);

    let existingFilters = {};
    try {
      const fetchRes = await fetchAPI('/api/scraper/config'); if (!fetchRes) return;
      if (fetchRes.ok) {
        const data = await fetchRes.json();
        if (data && data.filters) {
          existingFilters = typeof data.filters === 'string' ? JSON.parse(data.filters) : data.filters;
        }
      }
    } catch (e) {
      console.error('[Scraper] Error loading config:', e);
    }

    const routineUrl = document.getElementById('athome-routine-url').value.trim();
    existingFilters['athome_routine_url'] = routineUrl;

    try {
      const saveRes = await fetchAPI('/api/scraper/config', {
        method: 'POST',
        body: JSON.stringify({ filters: existingFilters })
      });
      if (!saveRes || !saveRes.ok) {
        showToast('Error al guardar la configuración.');
        return;
      }
    } catch (e) {
      showToast('Error al guardar la configuración.');
      return;
    }

    showToast('Configuración guardada correctamente.');
    closeConfigView();
    loadPresetsDropdown(); // Reload presets dropdown for the new target
    loadDatabase(); // Reload the table to apply the new filtering

    if (selected.value === 'athome' && routineUrl) {
      showToast('Iniciando rutina de extracción automática...');
      setTimeout(() => {
        startRoutine();
      }, 500);
    }
  }
}

async function sendDetailToTelegram() {
  const isAtHome = (localStorage.getItem('nv_scraper_target') || 'pccomponentes') === 'athome';
  if (!isAtHome) {
    showToast("Solo disponible para atHome.");
    return;
  }
  const p = state.allData.find(x => x.sku === state.currentProductSku);
  if (!p) return;
  const descEl = document.getElementById('raw-desc-text');
  const desc = descEl ? descEl.innerText.toLowerCase() : (p.description ? p.description.toLowerCase() : "");

  const msg = buildTelegramMessage(p, desc);
  showToast("Enviando a Telegram...");
  try {
    const res = await fetchAPI("/api/scraper/telegram/send_selected", {
      method: "POST", body: JSON.stringify({ messages: [msg] })
    });
    if (!res) return;
    if (res.ok) showToast("¡Enviado a Telegram con éxito!");
    else showToast("Error al enviar a Telegram.");
  } catch (err) {
    showToast("Error de conexión.");
  }
}





async function exportListPdf() {
  // Recoge los productos actualmente filtrados y ordenados
  const sourceData = state.filteredData || state.allData;
  if (!sourceData || !sourceData.length) { showToast('No hay resultados para exportar.'); return; }

  const btn = document.getElementById('btn-export-list-pdf');
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spin">↻</span> Generando...';
  btn.disabled = true;

  const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
  const products = sourceData.map(p => {
    return {
      sku: p.sku,
      title: p.title,
      brand: p.brand,
      price: p.price,
      price_formatted: p.price_formatted,
      availability: p.availability,
      category: p.category,
      rating_value: p.rating_value,
      rating_count: p.rating_count,
      url: p.url,
      prev_price: p.prev_price,
      distance: p.distance && p.distance !== 999999 ? p.distance : null,
      scraper_type: p.scraper_type,
      image: p.image,
    };
  }).filter(Boolean);

  try {
    const res = await fetchAPI('/api/scraper/export_list_pdf', {
      method: 'POST',
      body: JSON.stringify({ products, target })
    });
    if (!res) return;
    if (!res.ok) throw new Error('Error ' + res.status);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `listado_${target}_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  catch (e) {
    showToast('Error al generar PDF: ' + e.message);
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

async function initScraperModule() {
  await loadGeocodeCacheFromServer();
  await loadDatabase();
  await loadFilters(true);
}


async function batchScrapeListed() {
  const btn = document.getElementById('btn-wizard-scrape');
  const pbarContainer = document.getElementById('wizard-progress-bar');
  const pbarFill = document.getElementById('wizard-progress-fill');
  const msg2 = document.getElementById('wizard-msg-2');

  if (state.isBatchScrapingDescriptions) {
    // Cancel the batch
    state.isBatchScrapingDescriptions = false;
    if (btn) btn.innerText = "Cancelando...";
    return;
  }

  const listedItems = state.filteredData || [];
  if (listedItems.length === 0) {
    alert("No hay candidatos listados para scrapear.");
    return;
  }

  state.isBatchScrapingDescriptions = true;
  let failCount = 0;

  if (pbarContainer) pbarContainer.style.display = 'block';
  if (pbarFill) pbarFill.style.width = '0%';
  setWizardStep(2);

  for (let i = 0; i < listedItems.length; i++) {
    if (!state.isBatchScrapingDescriptions) {
      break; // User cancelled
    }

    const p = listedItems[i];
    if (btn) btn.innerText = `Scrapeando (${i + 1}/${listedItems.length}) - Clic para Cancelar`;
    if (msg2) msg2.innerText = `Leyendo la descripción de: ${p.title}...`;
    if (pbarFill) pbarFill.style.width = `${((i) / listedItems.length) * 100}%`;

    try {
      const url = '/api/scraper/description/' + encodeURIComponent(p.sku);
      // Try to fetch with a simple retry on NetworkError
      let res;
      try {
        res = await fetchAPI(url);
      } catch (netErr) {
        console.warn(`[Batch] Reintentando ${p.sku} tras fallo de red...`);
        await new Promise(r => setTimeout(r, 1000));
        res = await fetchAPI(url);
      }

      if (!res) {
        failCount++;
        continue;
      }
      if (!res.ok) {
        console.warn(`[Batch] Error ${res.status} al obtener ${p.sku}`);
        failCount++;
      } else {
        const data = await res.json();

        if (!data.error) {
          // Guardar la descripción para aplicar filtros regex
          let fullText = data.description || '';
          if (data.specs) {
            fullText += ' ' + Object.values(data.specs).join(' ');
            if (data.specs.is_removed) {
              p.availability = 'Agotado';
            } else {
              if (!p.availability || p.availability.includes('schema.org')) {
                p.availability = 'http://schema.org/InStock';
              }
            }
          }
          p.description_text = fullText;

          // Actualizar interfaz en tiempo real
          filterTable();
        }
      }
    } catch (e) {
      console.warn(`[Batch] Fallo final en ${p.sku}:`, e.message);
      failCount++;
    }

    // Delay para no saturar, asegurando que se ejecute siempre
    await new Promise(r => setTimeout(r, 400));
  }

  state.isBatchScrapingDescriptions = false;
  if (btn) btn.innerText = `Analizar descripciones de ${listedItems.length} candidatos`;
  if (pbarFill) pbarFill.style.width = `100%`;
  if (msg2) msg2.innerText = `¡Extracción completada! ${failCount > 0 ? `(${failCount} fallos)` : ''}`;

  setWizardStep(3);
  filterTable();
}

async function sendSelectedToTelegram() {
  const loading = document.getElementById('loading');
  if (state.selectedSkus.size === 0) {
    loading.style.display = 'flex';
    loading.innerHTML = '<span style="color:#ef4444;">Selecciona al menos un apartamento para enviar a Telegram.</span>';
    setTimeout(() => loading.style.display = 'none', 3000);
    return;
  }

  const btn = document.getElementById("btn-send-telegram");
  if (!btn) return;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spin">↻</span> Enviando...';
  btn.disabled = true;

  const messages = [];
  const isAtHome = (localStorage.getItem('nv_scraper_target') || 'pccomponentes') === 'athome';
  const refAddress = document.getElementById('filter-reference-address')?.value?.trim();

  if (isAtHome) {
    if (refAddress) {
      messages.push(`*Reference Location:* ${refAddress}`);
    }
    for (const sku of state.selectedSkus) {
      const p = state.allData.find(x => x.sku === sku);
      if (p) {
        const desc = p.description_text ? p.description_text.toLowerCase() : (p.description ? p.description.toLowerCase() : "");
        messages.push(buildTelegramMessage(p, desc));
      }
    }
  } else {
    messages.push(`*Manual Selection (${state.selectedSkus.size} items)*`);
    let idx = 1;
    for (const sku of state.selectedSkus) {
      const p = state.allData.find(x => x.sku === sku);
      if (p) {
        messages.push(`${idx++}. [${p.title}](${p.url})\n   💰 ${p.price}€`);
      }
    }
  }

  try {
    const payload = { messages: messages };
    const res = await fetchAPI("/api/scraper/telegram/send_selected", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!res) {
      showToast("Error de autenticación o conexión al enviar a Telegram.");
      return;
    }
    loading.style.display = 'flex';
    if (res.ok) {
      loading.innerHTML = '<span style="color:#22c55e; font-weight:bold;">¡Apartamentos enviados a Telegram con éxito!</span>';
      setTimeout(() => loading.style.display = 'none', 4000);
    } else {
      const data = await res.json();
      loading.style.display = 'flex';
      loading.innerHTML = '<span style="color:#ef4444;">Error: ' + (data.error || "No se pudo enviar") + '</span>';
      setTimeout(() => loading.style.display = 'none', 4000);
    }
  } catch (err) {
    loading.style.display = 'flex';
    loading.innerHTML = '<span style="color:#ef4444;">Error de red: ' + err.message + '</span>';
    setTimeout(() => loading.style.display = 'none', 4000);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function createBotRule() {
  const name = document.getElementById('bot-rule-name').value.trim();
  const max_price = parseFloat(document.getElementById('bot-rule-max-price').value) || 0;
  const min_surface = parseFloat(document.getElementById('bot-rule-min-surface').value) || 0;
  const keywords = document.getElementById('bot-rule-keywords').value.trim();

  if (!name) {
    alert("El nombre de la regla es obligatorio.");
    return;
  }

  const payload = {
    name: name,
    max_price: max_price,
    min_surface: min_surface,
    keywords: keywords,
    max_distance: 0 // Optional for now
  };

  try {
    const res = await fetchAPI('/api/scraper/bot_rules', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!res) return;
    if (res.ok) {
      document.getElementById('bot-rule-name').value = '';
      document.getElementById('bot-rule-max-price').value = '';
      document.getElementById('bot-rule-min-surface').value = '';
      document.getElementById('bot-rule-keywords').value = '';
      loadBotRules();
    } else {
      const data = await res.json();
      alert("Error al añadir la regla: " + (data.error || data.message));
    }
  } catch (err) {
    alert("Error de red: " + err.message);
  }
}

async function deleteBotRule(id) {
  if (!confirm("¿Seguro que quieres eliminar esta regla?")) return;
  try {
    const res = await fetchAPI('/api/scraper/bot_rules/' + id, {
      method: 'DELETE'
    });
    if (!res) return;
    if (res.ok) loadBotRules();
  } catch (e) { alert("Error: " + e.message); }
}

async function toggleBotRule(id, isActive) {
  try {
    const res = await fetchAPI('/api/scraper/bot_rules/' + id + '/toggle', {
      method: 'POST',
      body: JSON.stringify({ is_active: isActive })
    });
    if (!res) return;
    if (res.ok) loadBotRules();
  } catch (e) { alert("Error: " + e.message); }
}

initScraperModule();
