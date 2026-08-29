let spreadsheetData = {};
let evaluatedData = {};
let viewportStartRow = 1;
let viewportStartCol = 0;
const VIEWPORT_ROWS = 15;
const VIEWPORT_COLS = 10;

let selectionStart = null;
let selectionEnd = null;
let isSelecting = false;

let copiedRange = null;

let historyStack = [];
let historyIndex = -1;

function pushToHistory() {
    const currentState = JSON.stringify(spreadsheetData);
    if (historyIndex >= 0 && historyStack[historyIndex] === currentState) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(currentState);
    historyIndex++;
    if (historyStack.length > 50) { historyStack.shift(); historyIndex--; }
}

function showToast(msg, isError = false) {
    let toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: ${isError ? '#ef4444' : 'linear-gradient(135deg, var(--indigo) 0%, #4f46e5 100%)'};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        z-index: 999999;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        pointer-events: none;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        spreadsheetData = JSON.parse(historyStack[historyIndex]);
        recomputeAll(); renderGridViewport(); saveSpreadsheet();
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        spreadsheetData = JSON.parse(historyStack[historyIndex]);
        recomputeAll(); renderGridViewport(); saveSpreadsheet();
    }
}

function indexToColName(index) {
    let colName = '';
    let div = index + 1;
    while (div > 0) {
        let mod = (div - 1) % 26;
        colName = String.fromCharCode(65 + mod) + colName;
        div = parseInt((div - mod) / 26);
    }
    return colName;
}

function colNameToIndex(name) {
    let index = 0;
    for (let i = 0; i < name.length; i++) {
        index = index * 26 + (name.charCodeAt(i) - 64);
    }
    return index - 1;
}

const SUPPORTED_FORMULAS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];

function evaluateCell(cellId, visited = new Set()) {
    if (visited.has(cellId)) return "#REF!";
    visited.add(cellId);

    let raw = spreadsheetData[cellId] || '';
    if (typeof raw === 'string' && raw.startsWith('=')) {
        let formula = raw.substring(1).toUpperCase().replace(/\$/g, '');

        const getRangeValues = (start, end) => {
            let values = [];
            let startColMatch = start.match(/^[A-Z]+/)[0];
            let endColMatch = end.match(/^[A-Z]+/)[0];
            let startRowMatch = start.match(/\d+$/)[0];
            let endRowMatch = end.match(/\d+$/)[0];

            let startCol = colNameToIndex(startColMatch), endCol = colNameToIndex(endColMatch);
            let startRow = parseInt(startRowMatch), endRow = parseInt(endRowMatch);
            for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
                for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
                    let ref = indexToColName(c) + r;
                    let val = parseFloat(evaluateCell(ref, new Set(visited)));
                    if (!isNaN(val)) values.push(val);
                }
            }
            return values;
        };

        formula = formula.replace(/(SUM|AVERAGE|MIN|MAX|COUNT)\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (match, func, start, end) => {
            let vals = getRangeValues(start, end);
            if (vals.length === 0) return 0;
            if (func === 'SUM') return vals.reduce((a, b) => a + b, 0);
            if (func === 'AVERAGE') return vals.reduce((a, b) => a + b, 0) / vals.length;
            if (func === 'MIN') return Math.min(...vals);
            if (func === 'MAX') return Math.max(...vals);
            if (func === 'COUNT') return vals.length;
            return 0;
        });

        formula = formula.replace(/[A-Z]+[1-9][0-9]*/g, match => {
            let val = evaluateCell(match, new Set(visited));
            return isNaN(parseFloat(val)) ? 0 : parseFloat(val);
        });

        try {
            if (!/^[0-9+\-*/(). ]+$/.test(formula)) return "#NAME?";
            let result = new Function('return ' + formula)();
            return isNaN(result) || !isFinite(result) ? 0 : (Math.round(result * 100) / 100);
        } catch (e) {
            return "#ERROR!";
        }
    }
    return raw;
}

function recomputeAll() {
    evaluatedData = {};
    let errors = [];

    // 1. Evaluar todas las celdas con contenido, no solo el viewport
    for (let cellId of Object.keys(spreadsheetData)) {
        if (!spreadsheetData[cellId]) continue;

        let val = evaluateCell(cellId);
        let isError = typeof val === 'string' && val.startsWith('#');

        if (isError) {
            evaluatedData[cellId] = spreadsheetData[cellId];

            let rawFormula = spreadsheetData[cellId].toUpperCase();
            let errMsg = `Error de cálculo.`;

            if (val === '#NAME?') {
                if (rawFormula.includes('SUM(') && !rawFormula.match(/SUM\([A-Z]+\d+:[A-Z]+\d+\)/)) {
                    errMsg = `SUM espera un rango con ':' (ej. SUM(A1:B2)). Para celdas sueltas usa =A1+B2.`;
                } else if (rawFormula.includes('AVERAGE(') && !rawFormula.match(/AVERAGE\([A-Z]+\d+:[A-Z]+\d+\)/)) {
                    errMsg = `AVERAGE espera un rango con ':' (ej. AVERAGE(A1:B2)).`;
                } else if (rawFormula.match(/[A-Z]{2,}\(/)) {
                    errMsg = `Función desconocida. Usa referencias válidas.`;
                } else {
                    errMsg = `Caracteres no reconocidos. Usa solo +, -, *, /, () y celdas.`;
                }
            } else if (val === '#REF!') {
                errMsg = `Referencia circular detectada.`;
            } else {
                errMsg = `Error de sintaxis.`;
            }

            errors.push(`
                <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border-left: 2px solid #ef4444; margin-bottom: 4px;">
                    <strong style="color:#ef4444;">[${cellId}]</strong> <span style="color:#e2e8f0; font-weight: bold;">${rawFormula}</span><br>
                    <span style="color:#fca5a5; font-size: 0.7rem;">${errMsg}</span>
                </div>
            `);
        } else {
            evaluatedData[cellId] = val;
        }
    }

    // 2. Actualizar visualmente el viewport
    for (let c = 0; c < VIEWPORT_COLS; c++) {
        for (let r = 0; r < VIEWPORT_ROWS; r++) {
            let actualCol = viewportStartCol + c;
            let actualRow = viewportStartRow + r;
            let cellId = `${indexToColName(actualCol)}${actualRow}`;

            let input = document.getElementById(`cell-${cellId}`);
            if (input) {
                let isError = typeof evaluatedData[cellId] === 'string' && evaluatedData[cellId].startsWith('#');
                if (isError) {
                    input.style.color = '#ef4444';
                    input.style.fontWeight = 'bold';
                } else {
                    input.style.color = '';
                    input.style.fontWeight = '';
                }

                if (document.activeElement !== input) {
                    let isEditingThisCell = (document.activeElement && document.activeElement.id === 'formula-bar-input' && activeFormulaInput === input);
                    if (!isEditingThisCell) {
                        input.value = evaluatedData[cellId] !== undefined ? evaluatedData[cellId] : '';
                    }
                }
            }
        }
    }

    const debugPanel = document.getElementById('debug-panel');
    const debugLogs = document.getElementById('excel-debug-logs');
    if (debugPanel && debugLogs) {
        if (errors.length > 0) {
            debugLogs.innerHTML = errors.map(e => `<div>${e}</div>`).join('');
        } else {
            debugLogs.innerHTML = '<div style="color: var(--text-muted); font-size: 0.65rem; text-align: center; padding-top: 20px;">No hay errores de fórmulas.</div>';
        }
    }
}

function createExcelGrid() {
    const grid = document.getElementById('excel-grid');
    const container = document.getElementById('view-budgets');

    if (!grid || !container) {
        console.warn("Excel: No se encontraron los contenedores necesarios (excel-grid o view-budgets).");
        return;
    }

    let html = `
    <style>
        #excel-grid td.selected-cell {
            background: rgba(99, 102, 241, 0.2) !important;
            box-shadow: inset 0 0 0 1px var(--indigo);
        }
        #excel-grid td input {
            pointer-events: none;
        }
        #excel-grid td.editing input {
            pointer-events: auto;
        }
    </style>
    <thead><tr><th style="width: 65px; min-width: 65px; position: sticky; left: 0; z-index: 3; background: var(--surface-hi);"></th>`;
    for (let c = 0; c < VIEWPORT_COLS; c++) {
        html += `<th>${indexToColName(viewportStartCol + c)}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < VIEWPORT_ROWS; r++) {
        let actualRow = viewportStartRow + r;
        html += `<tr><td class="row-num">${actualRow}</td>`;
        for (let c = 0; c < VIEWPORT_COLS; c++) {
            const cellId = `${indexToColName(viewportStartCol + c)}${actualRow}`;
            html += `<td data-row="${r}" data-col="${c}" 
                        onmousedown="window.handleSelectionStart(event, ${r}, ${c})" 
                        onmouseenter="window.handleSelectionMove(event, ${r}, ${c})"
                        ondblclick="window.enterEditMode(${r}, ${c})"><input type="text" id="cell-${cellId}" data-cell="${cellId}" autocomplete="off"
                        onfocus="window.handleFocus(this)" 
                        onblur="window.updateCell(this)" 
                        oninput="window.handleInput(this)"
                        onkeydown="window.handleExcelKey(event, ${r}, ${c})"></td>`;
        }
        html += '</tr>';
    }
    html += '</tbody>';
    grid.innerHTML = html;

    if (!document.getElementById('excel-autocomplete')) {
        let ac = document.createElement('div');
        ac.id = 'excel-autocomplete';
        ac.style.cssText = 'position:absolute; display:none; background:var(--surface-hi); border:1px solid var(--border); border-radius:6px; z-index:1000; min-width:150px; box-shadow:0 4px 12px rgba(0,0,0,0.5);';
        container.appendChild(ac);
    }

    const parent = grid.parentElement;
    if (parent) {
        parent.removeEventListener('wheel', handleGridWheel);
        parent.addEventListener('wheel', handleGridWheel, { passive: false });
    }

    if (historyStack.length === 0) pushToHistory();
    setTimeout(recomputeAll, 50);
}

let _excelKeyListener = null;
function _setupExcelGlobalKeys() {
    if (_excelKeyListener) window.removeEventListener('keydown', _excelKeyListener);
    _excelKeyListener = (e) => {
        const view = document.getElementById('view-budgets');
        if (!view || view.style.display === 'none') return;

        if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                document.activeElement.blur();
            }
            undo();
        }
        if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            redo();
        }

        // Typing enters edit mode instantly
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && selectionStart && selectionEnd && selectionStart.row === selectionEnd.row && selectionStart.col === selectionEnd.col) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            const id = `${indexToColName(selectionStart.col)}${selectionStart.row}`;
            const input = document.getElementById(`cell-${id}`);
            if (input) {
                input.value = '';
                window.enterEditMode(selectionStart.row - viewportStartRow, selectionStart.col - viewportStartCol);
            }
        }

        // Enter key enters edit mode
        if (e.key === 'Enter' && selectionStart && selectionEnd && selectionStart.row === selectionEnd.row && selectionStart.col === selectionEnd.col) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            e.preventDefault();
            window.enterEditMode(selectionStart.row - viewportStartRow, selectionStart.col - viewportStartCol);
            return;
        }

        // Manejar Suprimir/Retroceso cuando no hay un input enfocado (selección global con Ctrl)
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectionStart && selectionEnd) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

            e.preventDefault();
            let changed = false;
            const minR = Math.min(selectionStart.row, selectionEnd.row), maxR = Math.max(selectionStart.row, selectionEnd.row);
            const minC = Math.min(selectionStart.col, selectionEnd.col), maxC = Math.max(selectionStart.col, selectionEnd.col);
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    const id = `${indexToColName(c)}${r}`;
                    if (spreadsheetData[id]) { delete spreadsheetData[id]; changed = true; }
                }
            }
            if (changed) { pushToHistory(); recomputeAll(); renderGridViewport(); saveSpreadsheet(); }
        }
    };
    window.addEventListener('keydown', _excelKeyListener);
}

function renderGridViewport() {
    const grid = document.getElementById('excel-grid');
    if (!grid) return;
    const ths = grid.querySelectorAll('thead th');
    for (let c = 0; c < VIEWPORT_COLS; c++) ths[c + 1].textContent = indexToColName(viewportStartCol + c);

    const trs = grid.querySelectorAll('tbody tr');
    for (let r = 0; r < VIEWPORT_ROWS; r++) {
        let actualRow = viewportStartRow + r;
        let tr = trs[r];
        tr.querySelector('.row-num').textContent = actualRow;

        let tds = tr.querySelectorAll('td:not(.row-num)');
        for (let c = 0; c < VIEWPORT_COLS; c++) {
            const cellId = `${indexToColName(viewportStartCol + c)}${actualRow}`;
            let td = tds[c];
            let input = td.querySelector('input');

            if (isInSelection(r, c)) td.classList.add('selected-cell');
            else td.classList.remove('selected-cell');

            input.id = `cell-${cellId}`;
            input.dataset.cell = cellId;

            let isEditingThisCell = (document.activeElement && document.activeElement.id === 'formula-bar-input' && activeFormulaInput === input);
            if (document.activeElement !== input && !isEditingThisCell) {
                input.value = evaluatedData[cellId] || '';
            }
        }
    }
}

function handleGridWheel(e) {
    let changed = false;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        if (e.deltaY > 0) { viewportStartRow++; changed = true; }
        else if (viewportStartRow > 1) { viewportStartRow--; changed = true; }
    } else {
        if (e.deltaX > 0) { viewportStartCol++; changed = true; }
        else if (viewportStartCol > 0) { viewportStartCol--; changed = true; }
    }

    if (changed) {
        e.preventDefault();
        recomputeAll();
        renderGridViewport();
    }
}

export async function fetchSpreadsheet() {
    try {
        const res = await fetch('/api/spreadsheet');
        spreadsheetData = await res.json();
        historyStack = []; historyIndex = -1;
        selectionStart = selectionEnd = null;
        pushToHistory();
        createExcelGrid();
    } catch (e) { console.error("Error fetching spreadsheet:", e); }
}

async function saveSpreadsheet() {
    const btn = document.querySelector('button[onclick="saveSpreadsheet()"]');
    if (btn) btn.textContent = 'Guardando...';
    try {
        await fetch('/api/spreadsheet', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ name: 'Principal', content: spreadsheetData })
        });
        showToast('¡Cambios guardados con éxito!');
    } catch (e) {
        showToast('Error al guardar ❌', true);
    } finally {
        if (btn) btn.textContent = 'Guardar Cambios';
    }
}

let activeFormulaInput = null;

window.addEventListener('mouseup', () => {
    isSelecting = false;
});

export function handleFocus(input) {
    const cellId = input.dataset.cell;
    input.value = spreadsheetData[cellId] || '';
    activeFormulaInput = input;
    document.getElementById('formula-bar-label').textContent = cellId;
    document.getElementById('formula-bar-input').value = input.value;

    // Al hacer focus, seleccionar todo el texto para que al escribir se reemplace
    // y al pulsar retroceso se borre, como en Excel.
    setTimeout(() => {
        if (document.activeElement === input) {
            input.select();
        }
    }, 10);
}

export function handleFormulaBarInput(e) {
    if (activeFormulaInput) {
        activeFormulaInput.value = e.target.value;
        handleInput(activeFormulaInput);
    }
}

export function handleFormulaBarKey(e) {
    if (activeFormulaInput) {
        if (e.key === 'Enter') updateCell(activeFormulaInput);
    }
}

export function handleFormulaBarBlur() {
    setTimeout(() => {
        const ac = document.getElementById('excel-autocomplete');
        if (ac) ac.style.display = 'none';
    }, 200);
}

export function updateCell(input) {
    setTimeout(() => {
        const ac = document.getElementById('excel-autocomplete');
        if (ac) ac.style.display = 'none';
    }, 200);
    const cellId = input.dataset.cell;
    if (spreadsheetData[cellId] !== input.value) {
        spreadsheetData[cellId] = input.value;
        pushToHistory();
        recomputeAll();
        saveSpreadsheet();
    }
}

let acIndex = -1;
let acItems = [];
let numRows = 100;
let numCols = 26;

export function handleInput(input) {
    if (document.activeElement === input) {
        document.getElementById('formula-bar-input').value = input.value;
    }
    const val = input.value.toUpperCase();
    const ac = document.getElementById('excel-autocomplete');
    if (val.startsWith('=')) {
        let matchStr = val.substring(1).match(/[A-Z]*$/);
        let search = matchStr ? matchStr[0] : '';
        acItems = SUPPORTED_FORMULAS.filter(f => f.startsWith(search));
        if (acItems.length > 0 && search.length > 0) {
            let rect = input.getBoundingClientRect();
            let containerRect = document.getElementById('view-budgets').getBoundingClientRect();
            ac.style.left = (rect.left - containerRect.left) + 'px';
            ac.style.top = (rect.bottom - containerRect.top + 5) + 'px';
            ac.style.display = 'block';
            acIndex = 0;
            renderAutocomplete();
        } else ac.style.display = 'none';
    } else ac.style.display = 'none';
}

function renderAutocomplete() {
    const ac = document.getElementById('excel-autocomplete');
    ac.innerHTML = acItems.map((item, i) =>
        `<div style="padding:8px 12px; cursor:pointer; font-size:0.8rem; font-weight:700; color:var(--text-main); background:${i === acIndex ? 'rgba(99,102,241,0.2)' : 'transparent'};" 
                onmousedown="window.selectAutocomplete('${item}')">${item}</div>`
    ).join('');
}

export function selectAutocomplete(funcName) {
    const input = document.activeElement;
    if (input && input.tagName === 'INPUT') {
        let val = input.value;
        let lastEq = val.lastIndexOf('=');
        input.value = val.substring(0, lastEq + 1) + funcName + '(';
        document.getElementById('excel-autocomplete').style.display = 'none';
        input.focus();
    }
}

export function handleExcelKey(e, row, col) {
    const ac = document.getElementById('excel-autocomplete');
    let isEditingFormula = document.activeElement && document.activeElement.id === 'formula-bar-input';

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectionStart && selectionEnd && !isEditingFormula) {
        let isMulti = (selectionStart.row !== selectionEnd.row || selectionStart.col !== selectionEnd.col);

        // Si hay varias celdas seleccionadas, o si todo el texto de la celda actual está seleccionado
        if (isMulti || (e.target.selectionStart === 0 && e.target.selectionEnd === e.target.value.length)) {
            let changed = false;
            const minR = Math.min(selectionStart.row, selectionEnd.row), maxR = Math.max(selectionStart.row, selectionEnd.row);
            const minC = Math.min(selectionStart.col, selectionEnd.col), maxC = Math.max(selectionStart.col, selectionEnd.col);
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    const id = `${indexToColName(c)}${r}`;
                    if (spreadsheetData[id]) { delete spreadsheetData[id]; changed = true; }
                }
            }
            if (changed) { pushToHistory(); recomputeAll(); renderGridViewport(); saveSpreadsheet(); }

            if (isMulti) {
                e.preventDefault();
            } else {
                e.target.value = '';
            }
            return;
        }
    }

    if (ac.style.display === 'block') {
        if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = (acIndex + 1) % acItems.length; renderAutocomplete(); return; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = (acIndex - 1 + acItems.length) % acItems.length; renderAutocomplete(); return; }
        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (acItems[acIndex]) selectAutocomplete(acItems[acIndex]); return; }
    }

    let nextCellId = null;
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        const actualRow = viewportStartRow + row;
        const actualCol = viewportStartCol + col;
        if (e.target.tagName === 'INPUT') updateCell(e.target);
        if (row >= VIEWPORT_ROWS - 1) {
            viewportStartRow++;
            recomputeAll();
            renderGridViewport();
        }
        nextCellId = `${indexToColName(actualCol)}${actualRow + 1}`;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const actualRow = viewportStartRow + row;
        const actualCol = viewportStartCol + col;
        if (e.target.tagName === 'INPUT') updateCell(e.target);
        if (row <= 0 && viewportStartRow > 1) {
            viewportStartRow--;
            recomputeAll();
            renderGridViewport();
        }
        if (actualRow > 1) {
            nextCellId = `${indexToColName(actualCol)}${actualRow - 1}`;
        }
    } else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) {
        const actualRow = viewportStartRow + row;
        const actualCol = viewportStartCol + col;
        if (e.target.tagName === 'INPUT') updateCell(e.target);
        if (col >= VIEWPORT_COLS - 1) {
            viewportStartCol++;
            recomputeAll();
            renderGridViewport();
        }
        nextCellId = `${indexToColName(actualCol + 1)}${actualRow}`;
    } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && (viewportStartCol + col) > 0) {
        const actualRow = viewportStartRow + row;
        const actualCol = viewportStartCol + col;
        if (e.target.tagName === 'INPUT') updateCell(e.target);
        if (col <= 0 && viewportStartCol > 0) {
            viewportStartCol--;
            recomputeAll();
            renderGridViewport();
        }
        nextCellId = `${indexToColName(actualCol - 1)}${actualRow}`;
    }

    if (nextCellId) {
        setTimeout(() => {
            const nextInput = document.getElementById(`cell-${nextCellId}`);
            if (nextInput) nextInput.focus();
        }, 10);
    }
}

export function togglePythonPanel() {
    const panel = document.getElementById('python-panel');
    panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
}

export async function runPythonScript() {
    const code = document.getElementById('python-code').value;
    const status = document.getElementById('python-status');
    const btn = document.getElementById('btn-run-python');

    if (!code.trim()) {
        status.textContent = '❌ Introduce algún código Python.';
        status.style.color = '#ef4444';
        return;
    }

    status.textContent = '⏳ Ejecutando script...';
    status.style.color = '#ffd700';
    btn.disabled = true;

    try {
        const res = await fetch('/api/spreadsheet/run-python', {
            method: 'POST',
            headers: window.HEADERS,
            body: JSON.stringify({ code: code, data: spreadsheetData })
        });
        const data = await res.json();

        if (data.ok) {
            spreadsheetData = data.data;
            pushToHistory();
            recomputeAll();
            renderGridViewport();
            saveSpreadsheet();
            status.textContent = 'Script ejecutado correctamente.';
            status.style.color = '#10b981';
        } else {
            status.textContent = '❌ Error: ' + data.error;
            status.style.color = '#ef4444';
        }
    } catch (e) {
        console.error(e);
        status.textContent = '❌ Error de conexión.';
        status.style.color = '#ef4444';
    } finally {
        btn.disabled = false;
    }
}

function isInSelection(r, c) {
    if (!selectionStart || !selectionEnd) return false;
    const actualR = viewportStartRow + r;
    const actualC = viewportStartCol + c;
    const minR = Math.min(selectionStart.row, selectionEnd.row);
    const maxR = Math.max(selectionStart.row, selectionEnd.row);
    const minC = Math.min(selectionStart.col, selectionEnd.col);
    const maxC = Math.max(selectionStart.col, selectionEnd.col);
    return actualR >= minR && actualR <= maxR && actualC >= minC && actualC <= maxC;
}

export function enterEditMode(r, c) {
    const id = `${indexToColName(viewportStartCol + c)}${viewportStartRow + r}`;
    const input = document.getElementById(`cell-${id}`);
    if (input) {
        const td = input.parentElement;
        td.classList.add('editing');
        input.focus();
        setTimeout(() => {
            const len = input.value.length;
            input.setSelectionRange(len, len);
        }, 15);
    }
}

export function exitEditMode() {
    document.querySelectorAll('#excel-grid td.editing').forEach(td => td.classList.remove('editing'));
}

export function handleSelectionStart(e, r, c) {
    if (e.target.tagName === 'INPUT' && document.activeElement === e.target) return;

    exitEditMode();

    e.preventDefault(); // Evita que el navegador intente seleccionar texto, permitiendo arrastrar limpio
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
    }

    isSelecting = true;
    selectionStart = { row: viewportStartRow + r, col: viewportStartCol + c };
    selectionEnd = { row: viewportStartRow + r, col: viewportStartCol + c };
    renderGridViewport();

    // Actualizar la barra de fórmulas instantáneamente
    const cellId = `${indexToColName(viewportStartCol + c)}${viewportStartRow + r}`;
    document.getElementById('formula-bar-label').textContent = cellId;
    document.getElementById('formula-bar-input').value = spreadsheetData[cellId] || '';
    const inputEl = document.getElementById(`cell-${cellId}`);
    if (inputEl) {
        activeFormulaInput = inputEl;
    }
}

export function handleSelectionMove(e, r, c) {
    if (!isSelecting) return;
    selectionEnd = { row: viewportStartRow + r, col: viewportStartCol + c };
    renderGridViewport();

    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
}

window.addEventListener('mouseup', () => {
    if (isSelecting) {
        isSelecting = false;

        if (selectionStart && selectionEnd) {
            if (selectionStart.row === selectionEnd.row && selectionStart.col === selectionEnd.col) {
                const id = `${indexToColName(selectionStart.col)}${selectionStart.row}`;
                const input = document.getElementById(`cell-${id}`);
                if (input) {
                    input.focus();
                }
            }
        }
    }
});

function shiftFormula(formula, rowOffset, colOffset) {
    if (!formula.startsWith('=')) return formula;
    return formula.replace(/(\$?)([A-Z]+)(\$?)(\d+)/g, (match, absCol, colStr, absRow, rowStr) => {
        let colIdx = colNameToIndex(colStr);
        if (!absCol) colIdx += colOffset;

        let rowIdx = parseInt(rowStr);
        if (!absRow) rowIdx += rowOffset;

        if (colIdx < 0) colIdx = 0;
        if (rowIdx < 1) rowIdx = 1;

        return `${absCol}${indexToColName(colIdx)}${absRow}${rowIdx}`;
    });
}

function handleCopy(e) {
    const view = document.getElementById('view-budgets');
    if (!view || view.style.display === 'none') return;
    if (e.target && e.target.closest && (e.target.closest('#chatbot-window') || e.target.closest('.nv-sidebar') || e.target.closest('.formula-bar'))) return;

    if (!selectionStart || !selectionEnd) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        if (document.activeElement.parentElement && document.activeElement.parentElement.classList.contains('editing')) {
            return; // Let normal copy happen
        }
    }

    e.preventDefault();
    const minR = Math.min(selectionStart.row, selectionEnd.row);
    const maxR = Math.max(selectionStart.row, selectionEnd.row);
    const minC = Math.min(selectionStart.col, selectionEnd.col);
    const maxC = Math.max(selectionStart.col, selectionEnd.col);

    copiedRange = {
        minR: minR,
        maxR: maxR,
        minC: minC,
        maxC: maxC,
        data: []
    };

    let textRows = [];
    for (let r = copiedRange.minR; r <= copiedRange.maxR; r++) {
        let rowData = [];
        let textCols = [];
        for (let c = copiedRange.minC; c <= copiedRange.maxC; c++) {
            const id = `${indexToColName(c)}${r}`;
            const val = spreadsheetData[id] || '';
            rowData.push(val);
            textCols.push(evaluatedData[id] !== undefined ? evaluatedData[id] : val);
        }
        copiedRange.data.push(rowData);
        textRows.push(textCols.join('\t'));
    }

    if (e.clipboardData) {
        e.clipboardData.setData('text/plain', textRows.join('\n'));
        e.clipboardData.setData('application/json', JSON.stringify({ source: 'null-void-excel' }));
    }
}

function handleCut(e) {
    const view = document.getElementById('view-budgets');
    if (!view || view.style.display === 'none') return;
    if (e.target && e.target.closest && (e.target.closest('#chatbot-window') || e.target.closest('.nv-sidebar') || e.target.closest('.formula-bar'))) return;

    if (!selectionStart || !selectionEnd) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        if (document.activeElement.parentElement && document.activeElement.parentElement.classList.contains('editing')) {
            return; // Let normal cut happen
        }
    }

    handleCopy(e);

    const minR = Math.min(selectionStart.row, selectionEnd.row);
    const maxR = Math.max(selectionStart.row, selectionEnd.row);
    const minC = Math.min(selectionStart.col, selectionEnd.col);
    const maxC = Math.max(selectionStart.col, selectionEnd.col);

    let changed = false;
    for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
            const id = `${indexToColName(c)}${r}`;
            if (spreadsheetData[id]) {
                delete spreadsheetData[id];
                changed = true;
            }
        }
    }

    if (changed) {
        pushToHistory();
        recomputeAll();
        renderGridViewport();
        saveSpreadsheet();
    }
}

function handlePaste(e) {
    const view = document.getElementById('view-budgets');
    if (!view || view.style.display === 'none') return;
    if (e.target && e.target.closest && (e.target.closest('#chatbot-window') || e.target.closest('.nv-sidebar') || e.target.closest('.formula-bar'))) return;

    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        if (document.activeElement.parentElement && document.activeElement.parentElement.classList.contains('editing')) {
            return; // Normal paste inside cell
        }
    }

    e.preventDefault();

    let startRow, startCol;
    if (selectionStart && selectionEnd && selectionStart.row === selectionEnd.row && selectionStart.col === selectionEnd.col) {
        startRow = viewportStartRow + selectionStart.row;
        startCol = viewportStartCol + selectionStart.col;
    } else {
        const active = document.activeElement;
        if (!active || !active.dataset.cell) return;
        const startCellId = active.dataset.cell;
        startCol = colNameToIndex(startCellId.match(/^[A-Z]+/)[0]);
        startRow = parseInt(startCellId.match(/\d+$/)[0]);
    }

    let isInternal = false;
    try {
        let json = (e.clipboardData || window.clipboardData).getData('application/json');
        if (json && JSON.parse(json).source === 'null-void-excel') {
            isInternal = true;
        }
    } catch (err) { }

    let changed = false;

    if (isInternal && copiedRange) {
        const rowOffset = startRow - copiedRange.minR;
        const colOffset = startCol - copiedRange.minC;

        for (let r = 0; r < copiedRange.data.length; r++) {
            for (let c = 0; c < copiedRange.data[r].length; c++) {
                let val = copiedRange.data[r][c];
                if (typeof val === 'string' && val.startsWith('=')) {
                    val = shiftFormula(val, rowOffset, colOffset);
                }
                const cellId = `${indexToColName(startCol + c)}${startRow + r}`;
                spreadsheetData[cellId] = val;
                changed = true;
            }
        }
    } else {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;

        const rows = text.split(/\r?\n/);
        rows.forEach((rowText, rowIndex) => {
            if (!rowText.trim() && rowIndex === rows.length - 1) return;
            const cols = rowText.split('\t');
            cols.forEach((colText, colIndex) => {
                const cellId = `${indexToColName(startCol + colIndex)}${startRow + rowIndex}`;
                spreadsheetData[cellId] = colText;
                changed = true;
            });
        });
    }

    if (changed) {
        pushToHistory();
        recomputeAll();
        renderGridViewport();
        saveSpreadsheet();
    }
}

const PYTHON_KEYWORDS = [
    'set_cell', 'get_cell', 'clear_all', 'math', 'datetime', 'range', 'print',
    'for', 'in', 'if', 'else', 'elif', 'while', 'def', 'return', 'import', 'math.pow', 'math.sqrt',
    'datetime.datetime.now'
];
let pyAcIndex = 0;
let pyAcItems = [];

export function handlePythonInput(e) {
    const textarea = e.target;
    const val = textarea.value;
    const pos = textarea.selectionStart;
    const before = val.substring(0, pos);
    const match = before.match(/([a-zA-Z0-9_]+)$/);

    const ac = document.getElementById('python-autocomplete');
    if (match) {
        const search = match[1];
        pyAcItems = PYTHON_KEYWORDS.filter(k => k.startsWith(search) && k !== search);
        if (pyAcItems.length > 0) {
            pyAcIndex = 0;
            showPythonAc(textarea);
            return;
        }
    }
    ac.style.display = 'none';
}

export function handlePythonKey(e) {
    const ac = document.getElementById('python-autocomplete');
    if (ac.style.display === 'block') {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            pyAcIndex = (pyAcIndex + 1) % pyAcItems.length;
            renderPythonAc();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            pyAcIndex = (pyAcIndex - 1 + pyAcItems.length) % pyAcItems.length;
            renderPythonAc();
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            selectPythonAc(pyAcItems[pyAcIndex]);
        } else if (e.key === 'Escape') {
            ac.style.display = 'none';
        }
    }
}

function showPythonAc(textarea) {
    const ac = document.getElementById('python-autocomplete');
    ac.style.left = `20px`;
    ac.style.bottom = `80px`;
    ac.style.display = 'block';
    renderPythonAc();
}

function renderPythonAc() {
    const ac = document.getElementById('python-autocomplete');
    ac.innerHTML = pyAcItems.map((item, i) => `
        <div onclick="window.selectPythonAc('${item}')" style="padding: 8px 12px; font-size: 0.75rem; color: ${i === pyAcIndex ? '#fff' : 'var(--text-muted)'}; background: ${i === pyAcIndex ? 'var(--indigo)' : 'transparent'}; cursor: pointer; font-family: monospace;">
            ${item}
        </div>
    `).join('');
}

export function selectPythonAc(word) {
    const textarea = document.getElementById('python-code');
    const val = textarea.value;
    const pos = textarea.selectionStart;
    const before = val.substring(0, pos);
    const after = val.substring(pos);
    const match = before.match(/([a-zA-Z0-9_]+)$/);

    if (match) {
        const newBefore = before.substring(0, before.length - match[1].length) + word;
        textarea.value = newBefore + after;
        textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    }
    document.getElementById('python-autocomplete').style.display = 'none';
    textarea.focus();
}

export function exportSpreadsheet() {
    const data = {
        app: "Null-Void Engine",
        version: "2.0",
        timestamp: new Date().toISOString(),
        content: spreadsheetData
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `excel_export_${new Date().getTime()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function importSpreadsheet(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            const content = data.content ? data.content : data;

            if (typeof content !== 'object') throw new Error("Formato inválido");

            spreadsheetData = content;
            pushToHistory();
            recomputeAll();
            renderGridViewport();
            saveSpreadsheet();
            showToast("Archivo importado correctamente.");
        } catch (err) {
            console.error(err);
            showToast("❌ Error al importar el archivo: Formato no válido.", true);
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

export function clearSpreadsheet() {
    const modal = document.getElementById('excel-confirm-modal');
    if (modal) modal.style.display = 'flex';
}

export async function executeClearSpreadsheet() {
    const modal = document.getElementById('excel-confirm-modal');
    if (modal) modal.style.display = 'none';

    spreadsheetData = {};
    pushToHistory();
    recomputeAll();
    renderGridViewport();
    await saveSpreadsheet();
}

export function applyBillingCalculatorUI() {
    let costInput = document.getElementById('billing-ui-cost');
    let costVal = parseFloat(costInput && costInput.value ? costInput.value : 0);
    let cost = isNaN(costVal) || costVal < 0 ? "0" : costVal.toString();

    let marginInput = document.getElementById('billing-ui-margin');
    let marginVal = parseFloat(marginInput && marginInput.value ? marginInput.value : 0);
    let margin = isNaN(marginVal) || marginVal < 0 ? "0" : marginVal.toString();

    let discountsInput = document.getElementById('billing-ui-discounts');
    let rawDiscounts = (discountsInput && discountsInput.value.trim() !== '') ? discountsInput.value : "0";
    let nameInput = document.getElementById('billing-ui-name');
    let productName = (nameInput && nameInput.value.trim() !== '') ? nameInput.value : "Desconocido";

    if (!spreadsheetData['A2'] || spreadsheetData['A2'] !== "INVERSION") {
        spreadsheetData = {}; // Clear everything

        spreadsheetData['A2'] = "INVERSION";
        spreadsheetData['A3'] = "INGRESOS";
        spreadsheetData['A4'] = "BENEFICIO";
        spreadsheetData['A5'] = "RETORNO";

        spreadsheetData['A7'] = "DATOS";
        spreadsheetData['A8'] = "PRODUCTO";
        spreadsheetData['A9'] = "COSTE";
        spreadsheetData['A10'] = "MARGEN";

        let discounts = rawDiscounts.split(/[\s,-]+/).map(d => parseFloat(d.replace(/[^0-9.]/g, ''))).filter(d => !isNaN(d) && d >= 0);
        if (discounts.length === 0) discounts = [0];

        let currentRow = 12;
        for (let i = 0; i < discounts.length; i++) {
            let disc = discounts[i];
            spreadsheetData[`A${currentRow}`] = `--${disc}%--`;
            spreadsheetData[`A${currentRow + 1}`] = "VENTA";
            spreadsheetData[`A${currentRow + 2}`] = "P.FINAL";
            spreadsheetData[`A${currentRow + 3}`] = "BENEFICIO";
            spreadsheetData[`A${currentRow + 4}`] = "RENTAB.";
            spreadsheetData[`A${currentRow + 5}`] = "RETORNO/€";
            currentRow += 7;
        }
    }

    let hasInput = (nameInput && nameInput.value.trim() !== '') ||
        (costInput && costInput.value.trim() !== '') ||
        (marginInput && marginInput.value.trim() !== '');

    if (!hasInput) {
        pushToHistory();
        recomputeAll();
        renderGridViewport();
        saveSpreadsheet();
        return;
    }

    if (!spreadsheetData['B2']) {
        spreadsheetData['B2'] = "=SUM(B9:ZZ9)";
        spreadsheetData['B3'] = "=SUM(B14:ZZ14)";
        spreadsheetData['B4'] = "=B3 - B2";
        spreadsheetData['B5'] = "=B4 / B2";
    }

    let colIdx = 1; // start at B (1)
    while (spreadsheetData[`${indexToColName(colIdx)}8`] !== undefined) {
        colIdx++;
    }
    const colStr = indexToColName(colIdx);

    spreadsheetData[`${colStr}8`] = productName;
    spreadsheetData[`${colStr}9`] = cost;
    spreadsheetData[`${colStr}10`] = margin;

    let r = 12;
    while (spreadsheetData[`A${r}`] !== undefined) {
        let match = spreadsheetData[`A${r}`].match(/--(\d+(?:\.\d+)?)%--/);
        if (match) {
            let discount = parseFloat(match[1]);
            spreadsheetData[`${colStr}${r + 1}`] = `=${colStr}${r + 2} / (1 - (${discount}/100))`;
            spreadsheetData[`${colStr}${r + 2}`] = `=${colStr}9 * (1 + (${colStr}10/100))`;
            spreadsheetData[`${colStr}${r + 3}`] = `=${colStr}${r + 2} - ${colStr}9`;
            spreadsheetData[`${colStr}${r + 4}`] = `=(${colStr}${r + 3} / ${colStr}9) * 100`;
            spreadsheetData[`${colStr}${r + 5}`] = `=${colStr}${r + 2} / ${colStr}9`;
            r += 7;
        } else {
            r++;
        }
    }

    pushToHistory();
    recomputeAll();
    renderGridViewport();
    saveSpreadsheet();
}

export function initExcel() {
    _setupExcelGlobalKeys();

    window.removeEventListener('copy', handleCopy);
    window.addEventListener('copy', handleCopy);
    window.removeEventListener('cut', handleCut);
    window.addEventListener('cut', handleCut);
    window.removeEventListener('paste', handlePaste);
    window.addEventListener('paste', handlePaste);

    const _originalShowView = window.showView;
    window.showView = function (viewId) {
        if (viewId === 'budgets') fetchSpreadsheet();
        if (typeof _originalShowView === 'function') _originalShowView(viewId);
    };
}

window.handleFocus = handleFocus;
window.handleFormulaBarInput = handleFormulaBarInput;
window.handleFormulaBarKey = handleFormulaBarKey;
window.handleFormulaBarBlur = handleFormulaBarBlur;
window.updateCell = updateCell;
window.handleInput = handleInput;
window.selectAutocomplete = selectAutocomplete;
window.handleExcelKey = handleExcelKey;
window.togglePythonPanel = togglePythonPanel;
window.runPythonScript = runPythonScript;
window.handleSelectionStart = handleSelectionStart;
window.handleSelectionMove = handleSelectionMove;
window.enterEditMode = enterEditMode;
window.exitEditMode = exitEditMode;
window.handlePythonInput = handlePythonInput;
window.handlePythonKey = handlePythonKey;
window.selectPythonAc = selectPythonAc;
window.exportSpreadsheet = exportSpreadsheet;
window.importSpreadsheet = importSpreadsheet;
window.saveSpreadsheet = saveSpreadsheet;
window.fetchSpreadsheet = fetchSpreadsheet;
window.clearSpreadsheet = clearSpreadsheet;
window.executeClearSpreadsheet = executeClearSpreadsheet;
window.applyBillingCalculatorUI = applyBillingCalculatorUI;
