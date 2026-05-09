/* Invoices Module Logic */

let allInvoices = [];

async function fetchInvoices() {
    try {
        const res = await fetch('/api/invoices/list?token=' + TOKEN, { headers: HEADERS });
        allInvoices = await res.json();
        renderInvoiceTable(allInvoices);
        updateInvoiceStats(allInvoices);
        populateInvoiceFilters(allInvoices);
    } catch (e) {
        console.error("Error fetching invoices:", e);
    }
}

function renderInvoiceTable(data) {
    const tbody = document.getElementById('invoice-tbody');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">No se encontraron facturas.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(inv => `
        <tr>
            <td style="font-weight: 600;">${inv.invoice_number}</td>
            <td>${inv.date}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${inv.client}</td>
            <td style="font-family: monospace; font-weight: 700;">${parseFloat(inv.total).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€</td>
            <td>
                <span class="badge badge-${inv.status}" onclick="toggleInvoiceStatus('${inv.id}', '${inv.status}')">
                    ${inv.status.replace('_', ' ').toUpperCase()}
                </span>
            </td>
            <td>
                <button class="btn-action" onclick="viewInvoiceDetail('${inv.id}')" title="Ver Detalle">👁</button>
            </td>
        </tr>
    `).join('');
}

function populateInvoiceFilters(data) {
    const clients = [...new Set(data.map(i => i.client))].sort();
    const clientSelect = document.getElementById('filter-client');
    if (!clientSelect) return;

    const currentClient = clientSelect.value;
    clientSelect.innerHTML = '<option value="">Todos los Clientes</option>' +
        clients.map(c => `<option value="${c}" ${c === currentClient ? 'selected' : ''}>${c}</option>`).join('');

    const years = [...new Set(data.map(i => i.date.split('/')[2]))].sort((a, b) => b - a);
    const yearSelect = document.getElementById('filter-year');
    if (yearSelect) {
        const currentYear = yearSelect.value;
        yearSelect.innerHTML = '<option value="">Año</option>' +
            years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
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

async function toggleInvoiceStatus(id, current) {
    const next = current === 'no_pagada' ? 'pagada' : (current === 'pagada' ? 'a_cuenta' : 'no_pagada');
    try {
        await fetch('/api/invoices/update_status?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ id, status: next })
        });
        fetchInvoices();
    } catch (e) { }
}

function filterInvoices(type) {
    const yearSelect = document.getElementById('filter-year');
    const monthSelect = document.getElementById('filter-month');
    const clientSelect = document.getElementById('filter-client');
    const statusSelect = document.getElementById('filter-status');

    if (!yearSelect) return;

    const year = yearSelect.value;
    const month = monthSelect.value;
    const client = clientSelect.value;
    const status = statusSelect.value;

    let filtered = allInvoices;

    if (type === 'all') {
        yearSelect.value = '';
        monthSelect.value = '';
        clientSelect.value = '';
        statusSelect.value = '';
    } else {
        if (year) filtered = filtered.filter(i => i.date.split('/')[2] === year);
        if (month) filtered = filtered.filter(i => i.date.split('/')[1] === month);
        if (client) filtered = filtered.filter(i => i.client === client);
        if (status) filtered = filtered.filter(i => i.status === status);
    }

    renderInvoiceTable(filtered);
}



async function handleInvoiceFileChange(input) {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/invoices/upload?token=' + TOKEN, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) fetchInvoices();
        else await NV_Alert("Error: " + data.error);
    } catch (e) { } finally { input.value = ''; }
}

function viewInvoiceDetail(id) {
    const inv = allInvoices.find(i => i.id === id);
    if (!inv) return;

    const cleanHtml = formatInvoiceData(inv);
    const contentEl = document.getElementById('invoice-full-content');
    if (contentEl) contentEl.innerHTML = cleanHtml;

    showView('invoice-detail');
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
        if (/^\d+[\.,]\d*/.test(parts[0]) && parts.length >= 5) {
            const qty = parts[0];
            const total = parts[parts.length - 1];
            const price = parts[parts.length - 3];
            const desc = parts.slice(2, parts.length - 3).join(' ');
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
        
        <!-- Header -->
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

        <!-- I. Memoria -->
        <div style="margin-bottom: 40px;">
            <div style="font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px;">I. MEMORIA TÉCNICA</div>
            <div style="font-size: 1.1rem; color: var(--text-main); font-style: italic; line-height: 1.4; opacity: 0.9;">
                ${mainDescription || "Intervención técnica programada."}
            </div>
        </div>

        <!-- II. Conceptos -->
        <div style="margin-bottom: 40px;">
            <div style="font-family: 'Inter', sans-serif; font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">II. CONCEPTOS Y CUANTÍAS</div>
            <table style="width: 100%; border-collapse: collapse; font-family: 'Inter', sans-serif;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border); color: var(--text-muted); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px;">
                        <th style="padding: 10px 5px; text-align: left; width: 60px;">Cant.</th>
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

        <!-- Summary -->
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

function closeInvoiceModal() {
    showView('invoices');
}
