/* ────────────────────────────────────────────────────────────
   SCRAPER MODULE · UI
   Capa de renderizado: grillas, detalle, wizard, vistas, toasts,
   gráfico de precios, mensajes Telegram y chatbot.
   Depende de state (estado) y api (fetchAPI).
   ──────────────────────────────────────────────────────────── */
import { state } from './state.js';
import { fetchAPI } from './api.js';

    export function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const target = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', target);
      if (target === 'dark') {
        localStorage.setItem('nv_theme', 'dark');
        document.getElementById('theme-icon-moon').style.display = 'none';
        document.getElementById('theme-icon-sun').style.display = 'block';
      } else {
        localStorage.setItem('nv_theme', 'light');
        document.getElementById('theme-icon-moon').style.display = 'block';
        document.getElementById('theme-icon-sun').style.display = 'none';
      }
    }

    export function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('collapsed');
    }

    export function updateDetailButtons(sku) {
      if (!sku) return;
      sku = String(sku);
      const favBtn = document.getElementById('detail-fav-btn');
      if (favBtn && favBtn.dataset.sku === sku) {
        favBtn.innerHTML = state.favorites.includes(sku) ? '★' : '☆';
        favBtn.style.color = state.favorites.includes(sku) ? '#ffb82b' : 'var(--text-main)';
        favBtn.style.opacity = state.favorites.includes(sku) ? '1' : '0.5';
      }
      const discBtn = document.getElementById('detail-discard-btn');
      if (discBtn && discBtn.dataset.sku === sku) {
        discBtn.innerHTML = state.discarded.includes(sku) ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        discBtn.style.opacity = state.discarded.includes(sku) ? '1' : '0.3';
      }
    }

    export function toggleRowSelection(sku, isChecked) {
      if (isChecked) state.selectedSkus.add(sku);
      else state.selectedSkus.delete(sku);
      updateBulkActionBar();
    }

    export function toggleSelectAll(isChecked) {
      const checkboxes = document.querySelectorAll('.prop-check');
      checkboxes.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) state.selectedSkus.add(cb.value);
        else state.selectedSkus.delete(cb.value);
      });
      updateBulkActionBar();
    }

    export function updateBulkActionBar() {
      const bar = document.getElementById('bulk-action-bar');
      const countLabel = document.getElementById('bulk-action-count');
      if (state.selectedSkus.size > 0) {
        bar.style.display = 'flex';
        countLabel.textContent = `${selectedSkus.size} seleccionado${selectedSkus.size !== 1 ? 's' : ''}`;
      } else {
        bar.style.display = 'none';
        const selectAll = document.getElementById('selectAllCheckbox');
        if (selectAll) selectAll.checked = false;
      }
    }

    export function toggleSection(id) {
      const container = document.getElementById('list-' + id);
      const chevron = document.getElementById('chevron-' + id);
      const btn = chevron.closest('.nav-collapsible');

      if (container.style.display === 'none' || container.style.display === '') {
        // Cerrar otros
        document.querySelectorAll('.sub-list').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.chevron').forEach(el => el.style.transform = 'rotate(0deg)');

        // Calcular posición
        const rect = btn.getBoundingClientRect();
        container.style.left = (rect.right + 10) + 'px';

        // Ajustar altura si se sale por debajo de la ventana
        const viewportH = window.innerHeight;
        let topPos = rect.top;
        if (topPos + 350 > viewportH) {
          topPos = viewportH - 360;
        }
        container.style.top = Math.max(10, topPos) + 'px';

        container.style.display = 'flex';
        chevron.style.transform = 'rotate(-90deg)';
      } else {
        container.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
      }
    }

    export function toggleUserMenu(e) {
      e.stopPropagation();
      const menu = document.getElementById('user-menu');
      if (menu.classList.contains('show')) {
        menu.classList.remove('show');
      } else {
        document.querySelectorAll('.user-menu-panel').forEach(m => m.classList.remove('show'));
        menu.classList.add('show');
      }
    }

    export function filterBrandsList() {
      const query = document.getElementById('search-brands').value.toLowerCase();
      const items = document.querySelectorAll('.brand-item');
      items.forEach(item => {
        const text = item.querySelector('span').textContent.toLowerCase();
        if (text.includes(query)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    }

    export function goToPage(page) {
      state.page = page;
      if (state.filteredData) {
        renderTable(state.filteredData, state.isFiltered);
        // Scroll grid back to top
        const grid = document.getElementById('db-body');
        if (grid) grid.scrollTop = 0;
        const mainArea = document.querySelector('.props-grid');
        if (mainArea) mainArea.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    export function renderTable(data, isFiltered = false) {
      const grid = document.getElementById('db-body');
      const PAGE_SIZE = state.PAGE_SIZE || 9;
      const currentPage = state.page || 1;
      const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
      // Clamp page
      state.page = Math.min(currentPage, totalPages);
      const page = state.page;
      const start = (page - 1) * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, data.length);

      document.getElementById('count-badge').textContent = data.length + ' resultado' + (data.length !== 1 ? 's' : '') + (isFiltered ? ' (filtrados)' : '');
      const wCount1 = document.getElementById('wizard-count-1');
      if (wCount1) wCount1.textContent = data.length;
      const wCount2 = document.getElementById('wizard-count-2');
      if (wCount2) wCount2.textContent = data.length;

      if (!data.length) {
        grid.innerHTML = `<div class="props-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto;display:block;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <div style="font-size:1rem;font-weight:700;margin-bottom:6px;">Sin resultados</div>
          <div style="font-size:0.82rem;">Prueba a ajustar los filtros del panel lateral</div>
        </div>`;
        return;
      }

      const paginatedData = data.slice(start, end);
      const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';

      let newHtml = paginatedData.map((p, idx) => {
        const itemIndex = (page - 1) * PAGE_SIZE + idx + 1;
        const isFav = state.favorites.includes(String(p.sku));
        const isDisc = state.discarded.includes(String(p.sku));
        const isSelected = state.selectedSkus.has(p.sku);
        const isJuicy = p.is_juicy;

        const isSold = (target === 'athome' && (p.price === 0 || p.availability === 'Agotado'));

        let priceTrendHtml = '';
        if (p.prev_price && p.prev_price !== p.price) {
          const diffPct = Math.abs((p.price - p.prev_price) / p.prev_price) * 100;
          if (p.price > p.prev_price) {
            priceTrendHtml = `<span class="price-trend" style="color:#f87171;">▲${diffPct.toFixed(1)}%</span>`;
          } else {
            priceTrendHtml = `<span class="price-trend" style="color:var(--green);">▼${diffPct.toFixed(1)}%</span>`;
          }
        }

        const objectFitStyle = target === 'athome' ? 'cover' : 'contain';
        const imgHtml = p.image
          ? `<img class="prop-img" src="${p.image}" alt="" style="object-fit: ${objectFitStyle}; background: #fff;" onerror="this.parentElement.innerHTML='<div class=\\'prop-img-placeholder\\'><svg width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\\'></path><polyline points=\\'9 22 9 12 15 12 15 22\\'></polyline></svg></div>'">`
          : `<div class="prop-img-placeholder" style="color:var(--text-sub);"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg></div>`;

        const badgeHtml = isSold
          ? `<span class="prop-badge sold">Vendido</span>`
          : isJuicy
            ? `<span class="prop-badge juicy-badge">⚡ Oferta</span>`
            : `<span class="prop-badge">${p.availability && p.availability !== 'Agotado' ? 'Disponible' : 'Disponible'}</span>`;

        let infoChips = '';
        if (target === 'athome') {
          if (p.rating_value) infoChips += `<span class="prop-chip">${p.rating_value}m²</span>`;
          if (p.rating_count) infoChips += `<span class="prop-chip">${p.rating_count} dorm.</span>`;
        }
        if (p.category) infoChips += `<span class="prop-chip" style="cursor:pointer;" onclick="event.stopPropagation();">${p.category}</span>`;
        if (p.brand) infoChips += `<span class="prop-chip green">${p.brand}</span>`;

        let distHtml = '';
        if (target === 'athome' && p.distance && p.distance !== 999999) {
          let distColor = p.distance > 40 ? '#fbbf24' : 'var(--text-sub)';
          if (p.distance > 100) distColor = '#f87171';
          distHtml = `<span class="prop-dist" style="color:${distColor};">${p.distance.toFixed(1)} km</span>`;
        }

        let mapLoc = p.availability || 'Luxembourg';
        if (mapLoc.includes('schema.org')) mapLoc = 'Luxembourg';

        const locParts = p.title.split(/\s(?:in|à|a|at)\s/i);
        if (locParts.length > 1) {
          mapLoc = locParts[locParts.length - 1].trim();
        }

        let mapOrigin = 'Luxembourg';
        const refInput = document.getElementById('filter-reference-address');
        if (refInput && refInput.value.trim() !== '') {
          mapOrigin = refInput.value.trim();
        }

        const mapLink = target === 'athome'
          ? `<a href="https://www.google.com/maps/dir/${encodeURIComponent(mapOrigin)}/${encodeURIComponent(mapLoc + ', Luxembourg')}" target="_blank" class="prop-link map" onclick="event.stopPropagation();">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              Mapa
            </a>`
          : '';

        return `
          <div class="prop-card${isJuicy ? ' juicy' : ''}${isSelected ? ' selected' : ''}" onclick="openProduct('${p.sku}')">
            <div class="prop-img-wrap">
              ${imgHtml}
              ${badgeHtml}
              <div class="prop-actions">
                <button class="prop-action-btn${isFav ? ' fav-active' : ''}" onclick="event.stopPropagation(); toggleFavorite('${p.sku}', event)" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                  ${isFav ? '★' : '☆'}
                </button>
                <button class="prop-action-btn${isDisc ? ' disc-active' : ''}" onclick="event.stopPropagation(); toggleDiscarded('${p.sku}', event)" title="Descartar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                </button>
              </div>
            </div>
            <div class="prop-body">
              <div class="prop-price">${p.price_formatted || '—'} ${priceTrendHtml}</div>
              <div class="prop-title"><span style="color:var(--text-sub); font-size:0.85em; margin-right:4px; font-weight:normal;">#${itemIndex}</span>${p.title}</div>
              <div class="prop-meta">
                ${infoChips}
                ${distHtml}
              </div>
            </div>
            <div class="prop-footer" onclick="event.stopPropagation();">
              <input type="checkbox" class="prop-check" value="${p.sku}" ${isSelected ? 'checked' : ''} onclick="toggleRowSelection('${p.sku}', this.checked)" title="Seleccionar">
              <a href="${p.url}" target="_blank" class="prop-link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                Ver anuncio
              </a>
              ${mapLink}
            </div>
          </div>`;
      }).join('');

      // Build pagination bar
      if (totalPages > 1) {
        const maxBtns = 7;
        let pages = [];
        if (totalPages <= maxBtns) {
          pages = Array.from({ length: totalPages }, (_, i) => i + 1);
        } else {
          pages = [1];
          let lo = Math.max(2, page - 2);
          let hi = Math.min(totalPages - 1, page + 2);
          if (lo > 2) pages.push('...');
          for (let i = lo; i <= hi; i++) pages.push(i);
          if (hi < totalPages - 1) pages.push('...');
          pages.push(totalPages);
        }
        const prevDisabled = page <= 1;
        const nextDisabled = page >= totalPages;
        const paginationHtml = `
          <div class="props-pagination" style="grid-column:1/-1; display:flex; align-items:center; justify-content:center; gap:6px; padding:12px 0;">
            <button class="pag-btn pag-arrow" onclick="goToPage(${page - 1})" ${prevDisabled ? 'disabled' : ''} title="Anterior">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            ${pages.map(p => p === '...'
          ? `<span style="color:var(--text-sub);padding:0 4px;">…</span>`
          : `<button class="pag-btn${p === page ? ' pag-active' : ''}" onclick="goToPage(${p})">${p}</button>`
        ).join('')}
            <button class="pag-btn pag-arrow" onclick="goToPage(${page + 1})" ${nextDisabled ? 'disabled' : ''} title="Siguiente">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <span style="font-size:0.72rem;color:var(--text-sub);margin-left:8px;">Página ${page} de ${totalPages} · ${data.length} resultados</span>
            <div style="display:flex; align-items:center; gap:4px; margin-left:8px;">
              <input type="number" id="pag-goto-input" min="1" max="${totalPages}" placeholder="Ir a..." style="width:60px; padding:4px 6px; font-size:0.75rem; background:var(--bg-card); border:1px solid var(--border-color); color:var(--text-main); border-radius:4px; outline:none;" onkeydown="if(event.key==='Enter') goToPage(this.value)">
              <button class="pag-btn" style="padding:4px 8px; font-size:0.75rem; min-width:auto;" onclick="goToPage(document.getElementById('pag-goto-input').value)">Ir</button>
            </div>
          </div>`;
        newHtml += paginationHtml;
      }

      if (grid.innerHTML !== newHtml) {
        grid.innerHTML = newHtml;
      }
    }

export async function openProduct(sku) {
      state.currentProductSku = sku;
      document.getElementById('view-main').style.display = 'none';
      const detail = document.getElementById('view-detail');
      detail.style.display = 'block';

      // Reset al estado de carga
      document.getElementById('desc-container').innerHTML = '<button id="btn-fetch-desc" class="btn-primary" style="width:100%; margin-top:8px; padding:6px; font-size:0.75rem;" onclick="fetchDescription()">Obtener descripción completa</button>';
      document.getElementById('detail-title').textContent = 'Cargando...';
      const detailFavBtn = document.getElementById('detail-fav-btn');
      if (detailFavBtn) detailFavBtn.dataset.sku = sku;
      const detailDiscBtn = document.getElementById('detail-discard-btn');
      if (detailDiscBtn) detailDiscBtn.dataset.sku = sku;
      updateDetailButtons(sku);

      document.getElementById('detail-breadcrumb-name').textContent = '';
      document.getElementById('detail-img').src = '';
      document.getElementById('detail-price').textContent = '—';
      document.getElementById('detail-brand').textContent = '';
      document.getElementById('detail-category').textContent = '';
      document.getElementById('detail-rating-widget').textContent = '—';
      document.getElementById('detail-stock-widget').textContent = '—';
      document.getElementById('detail-trend-widget').textContent = '—';
      document.getElementById('gallery-card').style.display = 'none';
      document.getElementById('gallery-container').innerHTML = '';

      const isAtHome = (localStorage.getItem('nv_scraper_target') || 'pccomponentes') === 'athome';
      const descLabel = document.getElementById('desc-card-label');
      if (descLabel) descLabel.textContent = isAtHome ? 'Descripción' : 'Especificaciones Técnicas';
      document.getElementById('desc-container').innerHTML = `<div style="text-align:center; padding:10px;"><button class="btn-primary" style="width:100%; padding:8px; font-size:0.8rem; background:var(--accent);" onclick="fetchDescription()">${isAtHome ? 'Obtener descripción completa' : 'Obtener especificaciones técnicas'}</button></div>`;

      // Auto-load if cached
      fetchDescription(true);
      document.getElementById('stat-min').textContent = '—';
      document.getElementById('stat-max').textContent = '—';
      document.getElementById('stat-count').textContent = '—';
      document.getElementById('chart-label-start').textContent = '—';
      document.getElementById('detail-graph').innerHTML =
        '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-sub);font-size:0.82rem;">Cargando historial...</div>';

      try {
        const res = await fetchAPI('/api/scraper/product/' + encodeURIComponent(sku));
        if (!res) return;
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const p = data.product;

        document.getElementById('detail-title').textContent = p.title;
        document.getElementById('detail-breadcrumb-name').textContent = p.title;
        document.getElementById('detail-img').src = p.image;

        let detailPriceHtml = p.price + '€';
        if (data.history && data.history.length > 1) {
          const prev = data.history[data.history.length - 2].price;
          if (p.price !== prev) {
            const diffPct = Math.abs((p.price - prev) / prev) * 100;
            if (p.price > prev) {
              detailPriceHtml += ` <span style="color:#f87171; font-size:1.1rem; margin-left:6px; position:relative; top:1px; font-weight:600;" title="Precio ha subido respecto al registro anterior">▲ ${diffPct.toFixed(1)}%</span>`;
            } else if (p.price < prev) {
              detailPriceHtml += ` <span style="color:var(--green); font-size:1.1rem; margin-left:6px; position:relative; top:1px; font-weight:600;" title="Precio ha bajado respecto al registro anterior">▼ ${diffPct.toFixed(1)}%</span>`;
            }
          }
        }
        document.getElementById('detail-price').innerHTML = detailPriceHtml;
        document.getElementById('detail-brand').textContent = p.brand;
        document.getElementById('detail-category').textContent = p.category;
        document.getElementById('detail-url').href = p.url;

        const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
        const lblRating = document.getElementById('insight-lbl-rating');

        // Valoración / Distancia
        if (target === 'athome') {
          if (lblRating) lblRating.textContent = 'Distancia a Ref.';
          // find the product in allData to get its calculated distance
          const memProd = state.allData.find(x => x.sku === p.sku);
          if (memProd && memProd.distance && memProd.distance !== 999999) {
            document.getElementById('detail-rating-widget').innerHTML = `<b>${memProd.distance.toFixed(2)}</b> km`;
            document.getElementById('detail-rating-widget').className = 'iv green';
          } else {
            document.getElementById('detail-rating-widget').innerHTML = '<span style="color:var(--text-sub);font-size:0.78rem;font-weight:400;">No calculada</span>';
            document.getElementById('detail-rating-widget').className = 'iv';
          }
        } else {
          if (lblRating) lblRating.textContent = 'Valoración media';
          if (p.rating_value > 0) {
            document.getElementById('detail-rating-widget').innerHTML =
              `★ ${p.rating_value} <span style="font-size:0.72rem;font-weight:400;color:var(--text-sub)">(${p.rating_count})</span>`;
            document.getElementById('detail-rating-widget').className = 'iv amber';
          } else {
            document.getElementById('detail-rating-widget').innerHTML = '<span style="color:var(--text-sub);font-size:0.78rem;font-weight:400;">Sin valoraciones</span>';
            document.getElementById('detail-rating-widget').className = 'iv';
          }
        }

        // Stock
        const inStock = p.availability && p.availability.includes('InStock');
        const rowStock = document.getElementById('insight-row-stock');
        if (target === 'athome') {
          if (rowStock) rowStock.style.display = 'none';
        } else {
          if (rowStock) rowStock.style.display = 'flex';
          document.getElementById('detail-stock-widget').innerHTML =
            `<span class="stock-dot" style="background:${inStock ? 'var(--green)' : '#f87171'}"></span>${inStock ? 'En stock' : 'Sin stock'}`;
          document.getElementById('detail-stock-widget').className = 'iv ' + (inStock ? 'green' : 'red');
        }

        // Tendencia
        let trend = 'Estable';
        let trendClass = '';
        if (data.history && data.history.length > 1) {
          const first = data.history[0].price;
          const last = data.history[data.history.length - 1].price;
          const diff = last - first;
          if (diff !== 0) {
            const diffPct = Math.abs(diff / first) * 100;
            if (diff < 0) {
              trend = `↓ Baja (${diff.toFixed(2)}€ / -${diffPct.toFixed(1)}%)`;
              trendClass = 'green';
            } else if (diff > 0) {
              trend = `↑ Sube (+${diff.toFixed(2)}€ / +${diffPct.toFixed(1)}%)`;
              trendClass = 'red';
            }
          }
        }
        document.getElementById('detail-trend-widget').textContent = trend;
        document.getElementById('detail-trend-widget').className = 'iv ' + trendClass;

        // Estadísticas del gráfico
        drawGraph(data.history, p.price);

      } catch (e) {
        document.getElementById('detail-graph').innerHTML =
          `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#f87171;font-size:0.82rem;">Error: ${e.message}</div>`;
      }
    }

export async function fetchDescription(cacheOnly = false) {
      const container = document.getElementById('desc-container');
      const isAtHomeLoad = (localStorage.getItem('nv_scraper_target') || 'pccomponentes') === 'athome';
      if (!cacheOnly) container.innerHTML = `<div style="text-align:center; padding:10px; color:var(--text-sub); font-size:0.8rem;"><span style="display:inline-block; animation: spin 1s linear infinite; margin-right:6px;">↻</span>${isAtHomeLoad ? 'Descargando descripción e imágenes...' : 'Extrayendo especificaciones técnicas...'}</div>`;
      try {
        const url = '/api/scraper/description/' + encodeURIComponent(state.currentProductSku) + (cacheOnly ? '?cache_only=true' : '');
        const res = await fetchAPI(url); if (!res) return;
        const data = await res.json();

        if (data.error) {
          if (cacheOnly) return; // Silent fail if only checking cache
          throw new Error(data.error);
        }

        if (cacheOnly && !data.description && !data.cached) {
          return; // Not in DB, leave the button
        }

        const isAtHome = (localStorage.getItem('nv_scraper_target') || 'pccomponentes') === 'athome';
        let htmlStr = '';

        if (!isAtHome && data.specs && Object.keys(data.specs).length > 0) {
          // PcComponentes: render as a clean technical specs table
          htmlStr += `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:0.7rem; color:var(--text-sub); opacity:0.7;">${Object.keys(data.specs).length} especificaciones extraídas</span>
              <button class="btn-back" onclick="exportProduct()" style="margin:0; padding:4px 10px; font-size:0.75rem; display:flex; align-items:center; gap:5px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Guardar .txt
              </button>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">`;
          const entries = Object.entries(data.specs);
          for (let i = 0; i < entries.length; i++) {
            const [key, val] = entries[i];
            const bg = i % 2 === 0 ? 'background:rgba(255,255,255,0.02);' : '';
            htmlStr += `<tr style="${bg}">
              <td style="padding:5px 8px; color:var(--text-sub); font-weight:600; white-space:nowrap; width:38%; vertical-align:top; border-right:1px solid var(--border-color);">${key}</td>
              <td style="padding:5px 8px; color:var(--text-main);">${val}</td>
            </tr>`;
          }
          htmlStr += `</table>`;
        } else {
          let summaryBtnHtml = '';
          if (isAtHome) {
            summaryBtnHtml = `
             <div style="display:flex; justify-content:flex-end; margin-bottom:8px; gap:8px;">
               <button class="btn-back" onclick="sendDetailToTelegram()" style="margin:0; padding:4px 10px; font-size:0.75rem; display:flex; align-items:center; gap:5px; background:rgba(59,130,246,0.1); color:#3b82f6; border:1px solid #3b82f6;">
                 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                 Enviar a Telegram
               </button>
               <button class="btn-back" onclick="copyAtHomeSummary()" style="margin:0; padding:4px 10px; font-size:0.75rem; display:flex; align-items:center; gap:5px; background:rgba(99,102,241,0.1); color:var(--primary); border:1px solid var(--primary);">
                 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                 Copiar Resumen
               </button>
             </div>`;
          }
          htmlStr = `${summaryBtnHtml}<div id="raw-desc-text" style="padding-top:8px; white-space:pre-wrap; font-size:0.8rem;">${data.description}</div>`;
        }

        // Contact / Agency — only show for atHome
        if (isAtHome && data.contact && data.contact !== 'Contacto no disponible.' && data.contact !== 'Contacto no disponible directamente.') {
          htmlStr += `<div style="margin-top:16px; padding:10px; background:var(--bg-lighter); border-radius:6px; border:1px solid var(--border-color);">
             <strong style="color:var(--text-main); display:block; margin-bottom:4px;">Agencia / Contacto:</strong>
             <span style="color:var(--text-sub); font-size:0.8rem;">${data.contact.replace(/\n/g, '<br>')}</span>
           </div>`;
        }

        if (data.images && data.images.length > 0) {
          const galCard = document.getElementById('gallery-card');
          const galCont = document.getElementById('gallery-container');
          galCard.style.display = 'block';

          let gridHtml = '';
          const imgs = data.images;

          const renderImg = (src, style) => `<div style="${style} cursor:pointer; overflow:hidden;" onclick="openLightbox('${src}')"><img src="${src}" style="width:100%; height:100%; object-fit:${isAtHome ? 'cover' : 'contain'}; background:#fff; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'"></div>`;

          if (imgs.length === 1) {
            gridHtml = `<div style="width:100%; border-radius:8px; overflow:hidden;">
                   ${renderImg(imgs[0], 'width:100%; height:280px;')}
               </div>`;
          } else if (imgs.length === 2) {
            gridHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; height:220px; width:100%; gap:4px; border-radius:8px; overflow:hidden;">
                   ${renderImg(imgs[0], '')}
                   ${renderImg(imgs[1], '')}
               </div>`;
          } else {
            // atHome style: 1 big left + 4 small right (2x2)
            gridHtml = `<div style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; grid-template-rows: 140px 140px; width:100%; gap:4px; border-radius:8px; overflow:hidden;">`;
            gridHtml += renderImg(imgs[0], 'grid-row: 1 / 3;');
            if (imgs[1]) gridHtml += renderImg(imgs[1], '');
            if (imgs[2]) gridHtml += renderImg(imgs[2], '');
            if (imgs[3]) gridHtml += renderImg(imgs[3], '');
            if (imgs[4]) gridHtml += renderImg(imgs[4], '');
            gridHtml += `</div>`;
          }
          galCont.innerHTML = gridHtml;
        }

        container.innerHTML = htmlStr;
      } catch (e) {
        container.innerHTML = `<div style="color:#f87171; text-align:center; padding:10px;">Error: ${e.message}</div><button class="btn-primary" style="width:100%; margin-top:8px; padding:6px; font-size:0.75rem;" onclick="fetchDescription()">Reintentar</button>`;
      }
    }

    export function openLightbox(src) {
      document.getElementById('lightbox-modal').style.display = 'flex';
      document.getElementById('lightbox-img').src = src;
    }

    export function closeLightbox(e) {
      // Prevent closing if clicking inside the image itself, only close on background or X
      if (e && e.target.id === 'lightbox-img') return;
      document.getElementById('lightbox-modal').style.display = 'none';
      document.getElementById('lightbox-img').src = '';
    }

    export function closeProductView() {
      document.getElementById('view-detail').style.display = 'none';
      document.getElementById('view-main').style.display = 'block';
    }

export async function showConfigView() {
      if (typeof state.isBatchScrapingDescriptions !== 'undefined' && state.isBatchScrapingDescriptions) {
        alert("Por favor, cancela o espera a que termine la extracción profunda (Fase 2) antes de entrar a Configuración.");
        return;
      }
      document.getElementById('view-main').style.display = 'none';
      document.getElementById('view-detail').style.display = 'none';
      document.getElementById('view-config').style.display = 'block';

      const target = localStorage.getItem('nv_scraper_target') || 'pccomponentes';
      const r = document.getElementById('target-' + target);
      if (r) r.checked = true;
      
      if (typeof toggleAtHomeConfigSection === 'function') {
        toggleAtHomeConfigSection();
      }

      try {
        const fetchRes = await fetchAPI('/api/scraper/config'); if (!fetchRes) return;
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data && data.filters) {
            const filters = typeof data.filters === 'string' ? JSON.parse(data.filters) : data.filters;
            if (filters['athome_routine_url']) {
              document.getElementById('athome-routine-url').value = filters['athome_routine_url'];
            }
          }
        }
      } catch(e) {}

      document.querySelectorAll('input[name="scraper-target"]').forEach(radio => {
        radio.addEventListener('change', toggleAtHomeConfigSection);
      });
    }

    export function savePccompTerms() {
      const termsArea = document.getElementById('config-pccomp-terms');
      if (termsArea) {
        localStorage.setItem('nv_pccomp_terms', termsArea.value);
        showToast("Términos guardados correctamente");
      }
    }

    export function closeConfigView() {
      document.getElementById('view-config').style.display = 'none';
      document.getElementById('view-main').style.display = 'block';
    }

    export function showToast(message) {
      let toast = document.getElementById('ai-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ai-toast';
        toast.className = 'ai-toast';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    export function drawGraph(history, currentPrice) {
      const graph = document.getElementById('detail-graph');

      if (!history || history.length === 0) {
        graph.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-sub);font-size:0.82rem;">Sin datos de historial.</div>';
        document.getElementById('stat-min').textContent = currentPrice ? currentPrice + '€' : '—';
        document.getElementById('stat-max').textContent = currentPrice ? currentPrice + '€' : '—';
        document.getElementById('stat-count').textContent = '1';
        return;
      }

      // Duplicar punto si solo hay uno para tener una línea
      if (history.length === 1) {
        history = [{ price: history[0].price, timestamp: history[0].timestamp - 86400 }, ...history];
      }

      const prices = history.map(h => h.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const rangeP = maxP - minP || 1;

      // Estadísticas
      document.getElementById('stat-min').textContent = minP.toFixed(2) + '€';
      document.getElementById('stat-max').textContent = maxP.toFixed(2) + '€';
      document.getElementById('stat-count').textContent = history.length;

      // Etiqueta de inicio del eje
      const t0 = history[0].timestamp;
      const dateStr = new Date(t0 * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
      document.getElementById('chart-label-start').textContent = dateStr;

      // Dimensiones
      const W = 600;
      const H = 150;
      const PAD = { top: 12, right: 16, bottom: 12, left: 16 };
      const w = W - PAD.left - PAD.right;
      const h = H - PAD.top - PAD.bottom;

      const t1 = history[history.length - 1].timestamp;
      const rangeT = t1 - t0 || 1;

      const points = history.map(entry => {
        const x = PAD.left + ((entry.timestamp - t0) / rangeT) * w;
        const y = PAD.top + h - ((entry.price - minP) / rangeP) * h;
        return { x, y, price: entry.price, timestamp: entry.timestamp };
      });

      const lineStr = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
      const areaStr = `M${PAD.left},${PAD.top + h} L${points.map(p => `${p.x},${p.y}`).join(' L')} L${PAD.left + w},${PAD.top + h} Z`;

      // Color de la línea según tendencia
      const trendUp = points[points.length - 1].price > points[0].price;
      const lineColor = trendUp ? '#f87171' : '#10b981';
      const areaColor = trendUp ? 'rgba(248,113,113,0.12)' : 'rgba(16,185,129,0.12)';

      graph.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="overflow:visible;" id="chart-svg">
          <defs>
            <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${areaStr}" fill="url(#chart-grad)"/>
          <path d="${lineStr}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div id="chart-hover-point" class="chart-tooltip-point" style="border-color:${lineColor}"></div>
        <div id="chart-hover-tip" class="chart-tooltip"></div>
      `;

      // Lógica de tooltip interactivo
      const pointEl = document.getElementById('chart-hover-point');
      const tipEl = document.getElementById('chart-hover-tip');

      graph.addEventListener('mousemove', (e) => {
        const rect = graph.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;

        const svgW = rect.width;
        let closest = points[0];
        let minDist = Infinity;

        points.forEach(p => {
          const screenX = (p.x / W) * svgW;
          const dist = Math.abs(mouseX - screenX);
          if (dist < minDist) {
            minDist = dist;
            closest = p;
          }
        });

        const pX = (closest.x / W) * 100;
        const pY = (closest.y / H) * 100;

        pointEl.style.left = pX + '%';
        pointEl.style.top = pY + '%';
        pointEl.style.opacity = '1';

        tipEl.style.left = pX + '%';
        tipEl.style.top = pY + '%';

        if (pX > 85) {
          tipEl.style.transform = 'translate(-100%, -120%)';
        } else if (pX < 15) {
          tipEl.style.transform = 'translate(0%, -120%)';
        } else {
          tipEl.style.transform = 'translate(-50%, -120%)';
        }

        const d = new Date(closest.timestamp * 1000);
        const dStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
        tipEl.innerHTML = `<strong style="font-size:0.9rem;color:var(--text-main)">${closest.price.toFixed(2)}€</strong><br><span style="color:var(--text-sub)">${dStr}</span>`;
        tipEl.style.opacity = '1';
      });

      graph.addEventListener('mouseleave', () => {
        pointEl.style.opacity = '0';
        tipEl.style.opacity = '0';
      });
    }

    export function buildTelegramMessage(p, desc) {
      let pets = "Not specified";
      if (desc.match(/no pets|pets not allowed|pets are not allowed|pets not permitted|pets are not permitted|pas d'animaux|sans animaux|animaux non acceptés|animaux interdits|no mascotas|sin mascotas|no se admiten|animaux ne sont pas admis|ne sont pas admis/i)) {
        pets = "No";
      } else if (desc.match(/pets allowed|animaux acceptés|mascotas permitidas|se admiten mascotas/i)) {
        pets = "Yes";
      }

      let parking = "No";
      let optionalMatch = desc.match(/(?:possibility of renting|optional|en option|en supplément|possibilité de louer)[^.\n\r]{0,30}(?:parking|garage|stationnement)/i) || desc.match(/(?:parking|garage|stationnement)[^.\n\r]{0,30}(?:possibility|optional|option|supplément)/i);

      if (optionalMatch) {
        parking = `Optional (${optionalMatch[0].trim()})`;
      } else if (desc.match(/parking|garage|plaza de garaje|stationnement/i)) {
        parking = "Yes";
        let match = desc.match(/(?:parking|garage|plaza de garaje|stationnement)[^.\n\r]{0,40}/i);
        if (match) {
          parking = `Yes (${match[0].trim()})`;
        }
      }

      let availability = "Not specified";
      let availMatch = desc.match(/(?:availability|disponibilité|disponibilidad)\s*[:|]?\s*([^\n\r.]+)/i);
      if (availMatch) {
        let str = availMatch[1].trim().split('*')[0].trim();
        // Remove trailing commas or dashes
        str = str.replace(/[,;-]+$/, '').trim();
        if (str) {
          availability = str.charAt(0).toUpperCase() + str.slice(1);
        }
      }

      const rent = p.price > 0 ? `${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : "N/A";
      const size = p.rating_value > 0 ? `${p.rating_value} m²` : "N/A";

      let distStr = "";
      if (p.distance && p.distance !== 999999) {
        distStr = `\n• Distance: ${p.distance.toFixed(1)} km`;
      }

      return `• Total Rent: ${rent}\n• Size: ${size}\n• Pets: ${pets}\n• Parking: ${parking}\n• Availability: ${availability}${distStr}\n• Link: (${p.url})`;
    }

    export function copyAtHomeSummary() {
      const p = allData.find(x => x.sku === currentProductSku);
      if (!p) return;

      const descEl = document.getElementById('raw-desc-text');
      const desc = descEl ? descEl.innerText.toLowerCase() : "";

      let pets = "Not specified";
      if (desc.match(/no pets|pets not allowed|pets are not allowed|pets not permitted|pets are not permitted|pas d'animaux|sans animaux|animaux non acceptés|animaux interdits|no mascotas|sin mascotas|no se admiten/i)) {
        pets = "No";
      } else if (desc.match(/pets allowed|animaux acceptés|mascotas permitidas|se admiten mascotas/i)) {
        pets = "Yes";
      }

      let parking = "No";
      let optionalMatch = desc.match(/(?:possibility of renting|optional|en option|en supplément|possibilité de louer)[^.\n\r]{0,30}(?:parking|garage|stationnement)/i) || desc.match(/(?:parking|garage|stationnement)[^.\n\r]{0,30}(?:possibility|optional|option|supplément)/i);

      if (optionalMatch) {
        parking = `Optional (${optionalMatch[0].trim()})`;
      } else if (desc.match(/parking|garage|plaza de garaje|stationnement/i)) {
        parking = "Yes";
        let match = desc.match(/(?:parking|garage|plaza de garaje|stationnement)[^.\n\r]{0,40}/i);
        if (match) {
          parking = `Yes (${match[0].trim()})`;
        }
      }

      const summary = buildTelegramMessage(p, desc);

      navigator.clipboard.writeText(summary).then(() => {
        showToast("Resumen copiado al portapapeles");
      }).catch(err => {
        console.error("Error al copiar: ", err);
        showToast("Error al copiar al portapapeles");
      });
    }

    export function toggleAtHomeConfigSection() {
      const isAtHome = document.getElementById('target-athome').checked;
      const sec = document.getElementById('athome-config-section');
      if (sec) sec.style.display = isAtHome ? 'block' : 'none';
    }

    export function setWizardStep(stepNumber) {
      // Update step badge colors
      const b1 = document.getElementById('badge-step-1');
      const b2 = document.getElementById('badge-step-2');
      const b3 = document.getElementById('badge-step-3');
      const b3pc = document.getElementById('badge-step-3-pc');
      const s2 = document.getElementById('filter-section-2');
      const s3a = document.getElementById('filter-section-3-athome');

      if (b1) b1.classList.remove('done');
      if (b2) b2.classList.remove('done');
      if (b3) b3.classList.remove('done');
      if (b3pc) b3pc.classList.remove('done');
      if (s2) s2.classList.remove('locked');
      if (s3a) s3a.classList.remove('locked');

      if (stepNumber >= 2 && b1) b1.classList.add('done');
      if (stepNumber >= 3 && b2) b2.classList.add('done');
    }

    export function showBotRulesView() {
      document.getElementById('view-main').style.display = 'none';
      document.getElementById('view-detail').style.display = 'none';
      document.getElementById('view-config').style.display = 'none';
      document.getElementById('view-bot-rules').style.display = 'block';
      loadBotRules();
    }

    export function closeBotRulesView() {
      document.getElementById('view-bot-rules').style.display = 'none';
      document.getElementById('view-main').style.display = 'block';
    }

export async function loadBotRules() {
      const container = document.getElementById('bot-rules-list');
      container.innerHTML = '<div style="color:var(--text-sub); font-size:0.8rem;">Cargando reglas...</div>';
      
      try {
        const res = await fetchAPI('/api/scraper/bot_rules'); if (!res) return;
        if (!res.ok) throw new Error("Error al cargar reglas");
        const data = await res.json();
        const rules = data.rules || [];
        
        if (rules.length === 0) {
            container.innerHTML = '<div style="color:var(--text-sub); font-size:0.8rem; padding: 12px; background: var(--bg-hover); border-radius: 6px;">No hay reglas de bot configuradas.</div>';
            return;
        }

        let html = '';
        rules.forEach(r => {
            const kws = r.keywords ? r.keywords : 'Ninguna';
            const priceStr = r.max_price ? `${r.max_price}€` : 'Sin límite';
            const surfStr = r.min_surface ? `${r.min_surface}m²` : 'Sin límite';
            const activeColor = r.is_active ? 'var(--primary)' : 'var(--text-sub)';
            const toggleText = r.is_active ? 'Desactivar' : 'Activar';
            
            html += `
            <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; background: var(--bg-lighter);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div style="font-weight: 600; color: ${activeColor}; font-size: 0.9rem;">
                        ${r.name} ${r.is_active ? '<span style="font-size:0.65rem; background:rgba(34,197,94,0.1); color:#22c55e; padding:2px 6px; border-radius:10px; margin-left:6px; vertical-align:middle;">ACTIVA</span>' : ''}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="toggleBotRule(${r.id}, ${r.is_active ? 'false' : 'true'})" style="font-size: 0.7rem; padding: 4px 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); border-radius: 4px; cursor: pointer;">
                            ${toggleText}
                        </button>
                        <button onclick="deleteBotRule(${r.id})" style="font-size: 0.7rem; padding: 4px 8px; border: 1px solid #ef4444; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 4px; cursor: pointer;">
                            Eliminar
                        </button>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.75rem; color: var(--text-sub);">
                    <div><strong style="color:var(--text-main)">Máx Precio:</strong> ${priceStr}</div>
                    <div><strong style="color:var(--text-main)">Mín Sup:</strong> ${surfStr}</div>
                    <div style="grid-column: 1 / -1"><strong style="color:var(--text-main)">Palabras Clave:</strong> ${kws}</div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = `<div style="color:#ef4444; font-size:0.8rem;">Error: ${err.message}</div>`;
      }
    }

    export function toggleChatbot() {
      const wnd = document.getElementById('chatbot-window');
      if (wnd.style.display === 'none' || wnd.style.display === '') {
        wnd.style.display = 'flex';
      } else {
        wnd.style.display = 'none';
      }
    };
