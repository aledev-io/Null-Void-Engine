import { NV_Alert } from './ui.js';

let allInvoices = [];
let sortField = 'date';
let sortAsc = false;

export async function fetchInvoices() {
    try {
        const res = await fetch('/api/invoices/list?token=' + window.TOKEN, { headers: window.HEADERS });
        allInvoices = await res.json();
        populateInvoiceFilters(allInvoices);
        filterInvoices();
        updateInvoiceStats(allInvoices);
    } catch (e) {
        console.error("Error fetching invoices:", e);
    }
}

export function renderInvoiceTable(data) {
    const tbody = document.getElementById('invoice-table-body');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No se encontraron facturas.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(inv => {
        let displayRef = inv.reference ? inv.reference.replace(/^[0-9a-f]{12}_/i, '') : '-';
        return `
        <tr class="${inv.status === 'pagada' ? 'row-pagada' : (inv.status === 'no_pagada' ? 'row-no_pagada' : 'row-a_cuenta')}">
            <td style="text-align: center;"><input type="checkbox" class="invoice-checkbox" value="${inv.id}" onclick="window.updateSelectedCount()"></td>
            <td style="font-weight: 600;">${inv.invoice_number}</td>
            <td>${inv.date}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${inv.client}</td>
            <td style="font-family: monospace; color: var(--text-dim);">${displayRef}</td>
            <td style="font-family: monospace; font-weight: 700; text-align: right;">${parseFloat(inv.total).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€</td>
            <td style="text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <span class="badge badge-${inv.status} status-badge" onclick="window.toggleInvoiceStatus('${inv.id}', '${inv.status}')">
                    ${inv.status.replace('_', ' ').toUpperCase()}
                </span>
                <button class="btn-action" onclick="window.viewInvoiceDetail('${inv.id}')" title="Ver Detalle" style="border: none; background: transparent; cursor: pointer; color: inherit; font-size: 1rem; opacity: 0.8; padding: 4px;">👁</button>
            </td>
        </tr>
    `}).join('');
}

function populateInvoiceFilters(data) {
    const clients = [...new Set(data.map(i => i.client))].sort();
    const clientSelect = document.getElementById('filter-client');
    if (!clientSelect) return;

    const currentClient = clientSelect.value;
    clientSelect.innerHTML = '<option value="">Todos los Clientes</option>' +
        clients.map(c => `<option value="${c}" ${c === currentClient ? 'selected' : ''}>${c}</option>`).join('');

    const years = [...new Set(data.map(i => i.date.split('-')[0]))].sort((a, b) => b - a);
    const yearSelect = document.getElementById('filter-year');
    if (yearSelect) {
        const currentYear = yearSelect.value;
        yearSelect.innerHTML = '<option value="">Sin filtro (Año)</option>' +
            years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
    }

    const dataList = document.getElementById('search-suggestions');
    if (dataList) {
        const suggestions = new Set();
        data.forEach(i => {
            if (i.invoice_number) suggestions.add(i.invoice_number);
            if (i.client) suggestions.add(i.client);
            if (i.date) suggestions.add(i.date);
            if (i.reference) {
                const cleanRef = i.reference.replace(/^[0-9a-f]{12}_/i, '');
                suggestions.add(cleanRef);
            }
        });
        dataList.innerHTML = Array.from(suggestions).sort().map(s => `<option value="${s}">`).join('');
    }
}

function updateInvoiceStats(data) {
    const total = data.reduce((acc, i) => acc + parseFloat(i.total), 0);
    const paid = data.filter(i => i.status === 'pagada').reduce((acc, i) => acc + parseFloat(i.total), 0);
    const unpaid = data.filter(i => i.status === 'no_pagada').reduce((acc, i) => acc + parseFloat(i.total), 0);

    const paidEl = document.getElementById('total-paid');
    const unpaidEl = document.getElementById('total-unpaid');
    const generalEl = document.getElementById('total-general');

    if (paidEl) paidEl.textContent = paid.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + '€';
    if (unpaidEl) unpaidEl.textContent = unpaid.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + '€';
    if (generalEl) generalEl.textContent = total.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + '€';
}

export async function toggleInvoiceStatus(id, current) {
    const next = current === 'no_pagada' ? 'pagada' : (current === 'pagada' ? 'a_cuenta' : 'no_pagada');
    try {
        await fetch('/api/invoices/update_status?token=' + window.TOKEN, {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ id, status: next })
        });
        fetchInvoices();
    } catch (e) { }
}

export function filterInvoices(type) {
    const yearSelect = document.getElementById('filter-year');
    const monthSelect = document.getElementById('filter-month');
    const clientSelect = document.getElementById('filter-client');
    const statusSelect = document.getElementById('filter-status');
    const searchInput = document.getElementById('filter-search');

    if (!yearSelect) return;

    const year = yearSelect.value;
    const month = monthSelect.value;
    const client = clientSelect.value;
    const status = statusSelect.value;
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let filtered = allInvoices;

    if (type === 'all') {
        yearSelect.value = '';
        monthSelect.value = '';
        clientSelect.value = '';
        statusSelect.value = '';
        if (searchInput) searchInput.value = '';
    } else {
        if (year) filtered = filtered.filter(i => i.date.split('-')[0] === year);
        if (month) filtered = filtered.filter(i => i.date.split('-')[1] === month);
        if (client) filtered = filtered.filter(i => i.client === client);
        if (status) filtered = filtered.filter(i => i.status === status);
        if (search) {
            filtered = filtered.filter(i =>
                (i.invoice_number && i.invoice_number.toLowerCase().includes(search)) ||
                (i.client && i.client.toLowerCase().includes(search)) ||
                (i.reference && i.reference.toLowerCase().includes(search)) ||
                (i.total && i.total.toString().includes(search)) ||
                (i.date && i.date.includes(search))
            );
        }
    }

    filtered.sort((a, b) => {
        let valA = a[sortField] || '';
        let valB = b[sortField] || '';
        if (sortField === 'date') {
            valA = new Date(valA).getTime();
            valB = new Date(valB).getTime();
        } else if (sortField === 'invoice_number') {
            const numA = parseInt(valA.replace(/\D/g, '')) || 0;
            const numB = parseInt(valB.replace(/\D/g, '')) || 0;
            if (numA !== numB) return sortAsc ? numA - numB : numB - numA;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });

    renderInvoiceTable(filtered);
}

export function toggleSort(field) {
    if (sortField === field) {
        sortAsc = !sortAsc;
    } else {
        sortField = field;
        sortAsc = true;
    }

    document.querySelectorAll('[id^="sort-arrow-"]').forEach(el => el.style.opacity = '0.3');
    const arrow = document.getElementById(`sort-arrow-${field}`);
    if (arrow) {
        arrow.style.opacity = '1';
        arrow.textContent = sortAsc ? '↑' : '↓';
    }

    filterInvoices();
}

export async function handleInvoiceFileChange(input) {
    if (!input.files || input.files.length === 0) return;

    let hasErrors = false;
    let errorMessages = [];
    document.body.style.cursor = 'wait';

    for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/invoices/upload?token=' + window.TOKEN, { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.ok) {
                hasErrors = true;
                errorMessages.push(`${file.name}: ${data.error}`);
            }
        } catch (e) {
            hasErrors = true;
            errorMessages.push(`${file.name}: Error de conexión`);
        }
    }

    input.value = '';
    document.body.style.cursor = 'default';

    if (hasErrors) {
        await NV_Alert("Errores:\n" + errorMessages.join('\n'));
    }

    fetchInvoices();
}

export function viewInvoiceDetail(id) {
    const inv = allInvoices.find(i => i.id == id);
    if (!inv) return;

    const cleanHtml = formatInvoiceData(inv);
    const contentEl = document.getElementById('invoice-full-content');
    if (contentEl) contentEl.innerHTML = cleanHtml;

    window.showView('invoice-detail');
}

function formatInvoiceData(inv) {
    const raw = inv.raw_text || "";
    if (!raw) return '<div style="text-align: center; padding: 40px; color: #666;">> No hay datos disponibles para esta factura.</div>';

    const lines = raw.split('\n');
    let items = [];
    let mainDescription = "";
    let displayClient = inv.client;

    const addressPatterns = ["calle", "avda", "c/", "avenida", "carretera", "paseo", "planta"];
    const isAddress = addressPatterns.some(p => displayClient.toLowerCase().includes(p));

    if (isAddress) {
        const clientSearch = raw.match(/(?:RECEPTOR|CLIENTE)[:\s]+([A-Z0-9\s\.]{5,40}(?:S\.A\.|S\.L\.|S\.A\.U\.)?)/i);
        if (clientSearch && clientSearch[1] && !addressPatterns.some(p => clientSearch[1].toLowerCase().includes(p))) {
            displayClient = clientSearch[1].trim();
        } else {
            displayClient = "Cliente Registrado";
        }
    }

    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length < 5) continue;
        if (trimmed.toLowerCase().includes("localización") || trimmed.toLowerCase().includes("reparación")) {
            mainDescription = trimmed;
            continue;
        }
        const parts = trimmed.split(/\s+/);
        if (/^\d+([\.,]\d+)?$/.test(parts[0]) && parts.length >= 4) {
            const qty = parts[0];
            const total = parts[parts.length - 1];
            const price = parts[parts.length - 3] || parts[parts.length - 2];
            let descStartIndex = 1;
            if (/^\d+$/.test(parts[1])) descStartIndex = 2;

            const descEndIndex = parts.length - (parts.length > 5 ? 3 : 2);
            const desc = parts.slice(descStartIndex, descEndIndex).join(' ');

            if (desc.length > 2) items.push({ qty, desc, price, total });
        }
    }

    const statusColors = {
        'pagada': { color: '#10b981', label: '✓ DOCUMENTO LIQUIDADO' },
        'no_pagada': { color: '#ef4444', label: '⚠ PENDIENTE DE COBRO' },
        'a_cuenta': { color: '#fbbf24', label: '● ABONO PARCIAL' }
    };
    const s = statusColors[inv.status] || statusColors['no_pagada'];

    return `
    <div style="font-family: 'Times New Roman', Times, serif; color: var(--text-main); line-height: 1.6; max-width: 850px; margin: 0 auto; padding: 40px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
        
        <div style="border-bottom: 2px solid var(--border); padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div style="font-family: 'Inter', sans-serif;">
                <div style="font-size: 0.65rem; font-weight: 800; color: var(--indigo); letter-spacing: 2px; margin-bottom: 10px;">CLIENTE / RECEPTOR</div>
                <h1 style="margin: 0; font-size: 1.6rem; color: var(--text-main); font-weight: 900;">${displayClient}</h1>
            </div>
            <div style="text-align: right; font-family: 'Inter', sans-serif;">
                <div style="font-size: 0.7rem; font-weight: 800; color: ${s.color}; margin-bottom: 8px; letter-spacing: 1px;">${s.label}</div>
                <div style="font-size: 0.9rem; color: var(--text-dim);">Ref: <span style="color: var(--text-main); font-weight: 700;">${inv.invoice_number}</span></div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${inv.date}</div>
            </div>
        </div>

        <div style="margin-bottom: 40px;">
            <div style="font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px;">I. MEMORIA TÉCNICA</div>
            <div style="font-size: 1.1rem; color: var(--text-main); font-style: italic; line-height: 1.4; opacity: 0.9;">
                ${mainDescription || "Intervención técnica programada."}
            </div>
        </div>

        <div style="margin-bottom: 40px;">
            <div style="font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">II. CONCEPTOS Y CUANTÍAS</div>
            <table style="width: 100%; border-collapse: collapse; font-family: 'Inter', sans-serif;">
            <tr style="border-bottom: 2px solid var(--border); color: var(--text-muted); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px;">
                        <th style="padding: 10px 5px; text-align: left; width: 60px;">Cant.</th>
            <thead>
                        <th style="padding: 10px 5px; text-align: left;">Descripción Detallada</th>
                        <th style="padding: 10px 5px; text-align: right; width: 80px;">P.U.</th>
                        <th style="padding: 10px 5px; text-align: right; width: 90px;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding: 15px 5px; color: var(--indigo); font-family: monospace; font-size: 0.85rem;">${item.qty}</td>
                            <td style="padding: 15px 5px; color: var(--text-main); font-size: 0.85rem; font-family: 'Times New Roman', serif;">${item.desc}</td>
                            <td style="padding: 15px 5px; color: var(--text-dim); font-size: 0.8rem; text-align: right; font-family: monospace;">${item.price}</td>
                            <td style="padding: 15px 5px; color: var(--text-main); font-size: 0.85rem; text-align: right; font-weight: 700; font-family: monospace;">${item.total}</td>
                        </tr>
                    `).join('')}
                    ${items.length === 0 ? '<tr><td colspan="4" style="padding: 30px; color: var(--text-muted); text-align: center; font-style: italic;">Sin desglose automático disponible.</td></tr>' : ''}
                </tbody>
            </table>
        </div>

        <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
            <div style="width: 280px; border-top: 3px solid var(--text-main); padding-top: 20px; text-align: right;">
                <div style="font-family: 'Inter', sans-serif; font-size: 0.6rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 5px;">Importe Total Bruto</div>
                <div style="font-size: 2.5rem; font-weight: 200; color: var(--text-main); letter-spacing: -2px; font-family: 'Inter', sans-serif;">
                    ${parseFloat(inv.total).toLocaleString('es-ES', { minimumFractionDigits: 2 })}<span style="font-size: 1.2rem; font-weight: 400; margin-left: 5px;">€</span>
                </div>
            </div>
        </div>

        <div style="margin-top: 80px; text-align: center; font-family: 'Inter', sans-serif; font-size: 0.65rem; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; opacity: 0.7;">
            Documento generado electrónicamente · Null-Void ERP
        </div>
    </div>
    `;
}

export function closeInvoiceModal() {
    window.showView('invoices');
}

export function toggleAllInvoices(checked) {
    document.querySelectorAll('.invoice-checkbox').forEach(cb => cb.checked = checked);
    updateSelectedCount();
}

export function updateSelectedCount() {
    const selected = document.querySelectorAll('.invoice-checkbox:checked');
    const count = selected.length;
    const btn = document.getElementById('btn-delete-selected');
    const countSpan = document.getElementById('selected-count');

    if (countSpan) countSpan.textContent = count;
    if (btn) btn.style.display = count > 0 ? 'inline-block' : 'none';
}

export function openDeleteModal() {
    const selected = document.querySelectorAll('.invoice-checkbox:checked');
    if (selected.length === 0) return;

    const countSpan = document.getElementById('delete-modal-count');
    if (countSpan) countSpan.textContent = selected.length;

    document.getElementById('delete-confirm-input').value = '';
    document.getElementById('btn-final-delete').disabled = true;
    document.getElementById('btn-final-delete').style.opacity = '0.3';
    document.getElementById('btn-final-delete').style.cursor = 'not-allowed';

    document.getElementById('delete-confirm-modal').style.display = 'flex';
}

export function validateDeleteConfirm(val) {
    const btn = document.getElementById('btn-final-delete');
    if (val === 'CONFIRMAR') {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.3';
        btn.style.cursor = 'not-allowed';
    }
}

export function closeDeleteModal() {
    document.getElementById('delete-confirm-modal').style.display = 'none';
}

export async function executeDelete() {
    const selected = Array.from(document.querySelectorAll('.invoice-checkbox:checked')).map(cb => parseInt(cb.value));
    if (selected.length === 0) return;

    try {
        await fetch('/api/invoices/delete?token=' + window.TOKEN, {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ ids: selected })
        });
        closeDeleteModal();

        const masterCb = document.getElementById('master-checkbox');
        if (masterCb) masterCb.checked = false;

        await fetchInvoices();
        updateSelectedCount();
    } catch (e) {
        console.error("Error deleting invoices:", e);
    }
}

window.toggleInvoiceStatus = toggleInvoiceStatus;
window.viewInvoiceDetail = viewInvoiceDetail;
window.updateSelectedCount = updateSelectedCount;
window.openDeleteModal = openDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.validateDeleteConfirm = validateDeleteConfirm;
window.executeDelete = executeDelete;
window.toggleAllInvoices = toggleAllInvoices;
window.closeInvoiceModal = closeInvoiceModal;
window.filterInvoices = filterInvoices;
window.toggleSort = toggleSort;
window.handleInvoiceFileChange = handleInvoiceFileChange;
