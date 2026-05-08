// ── LÓGICA DE EXCEL (SPREADSHEET) ──
let spreadsheetData = {};
let evaluatedData = {};
let viewportStartRow = 1;
let viewportStartCol = 0;
const VIEWPORT_ROWS = 15;
const VIEWPORT_COLS = 15;

// Selección de rango
let selectionStart = null; // {row, col}
let selectionEnd = null;   // {row, col}
let isSelecting = false;

// Historial para deshacer/rehacer
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
        let formula = raw.substring(1).toUpperCase();

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
            // Solo permite caracteres matemáticos
            if (!/^[0-9+\-*/(). ]+$/.test(formula)) return "#NAME?";
            let result = new Function('return ' + formula)();
            return isNaN(result) ? "#VALUE!" : (Math.round(result * 100) / 100);
        } catch (e) {
            return "#ERROR!";
        }
    }
    return raw;
}

function recomputeAll() {
    evaluatedData = {};
    let errors = [];

    for (let c = 0; c < VIEWPORT_COLS; c++) {
        for (let r = 0; r < VIEWPORT_ROWS; r++) {
            let actualCol = viewportStartCol + c;
            let actualRow = viewportStartRow + r;
            let cellId = `${indexToColName(actualCol)}${actualRow}`;

            let val = evaluateCell(cellId);
            let isError = typeof val === 'string' && val.startsWith('#');

            if (isError) {
                evaluatedData[cellId] = spreadsheetData[cellId];

                let rawFormula = spreadsheetData[cellId].toUpperCase();
                let errMsg = `Error de sintaxis.`;

                if (rawFormula.includes('SUM(') && !rawFormula.match(/SUM\([A-Z]+\d+:[A-Z]+\d+\)/)) {
                    errMsg = `SUM espera un rango con ':' (ej. SUM(A1:B2)). Para celdas sueltas usa =A1+B2.`;
                } else if (rawFormula.includes('AVERAGE(') && !rawFormula.match(/AVERAGE\([A-Z]+\d+:[A-Z]+\d+\)/)) {
                    errMsg = `AVERAGE espera un rango con ':' (ej. AVERAGE(A1:B2)).`;
                } else if (rawFormula.match(/[A-Z]{2,}\(/)) {
                    errMsg = `Función desconocida o mal formateada. Asegúrate de usar rangos válidos.`;
                } else {
                    errMsg = `Caracteres no reconocidos. Usa solo +, -, *, /, () y referencias a celdas.`;
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

            let input = document.getElementById(`cell-${cellId}`);
            if (input) {
                if (isError) {
                    input.style.color = '#ef4444';
                    input.style.fontWeight = 'bold';
                } else {
                    input.style.color = '';
                    input.style.fontWeight = '';
                }

                if (document.activeElement !== input) {
                    // Si el usuario está editando ESTA celda a través de la barra de fórmulas, no sobrescribas su fórmula sin procesar
                    let isEditingThisCell = (document.activeElement && document.activeElement.id === 'formula-bar-input' && activeFormulaInput === input);
                    if (!isEditingThisCell) {
                        input.value = evaluatedData[cellId];
                    }
                }
            }
        }
    }

    const debugPanel = document.getElementById('excel-debug-panel');
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
    </style>
    <thead><tr><th style="width: 40px;"></th>`;
    for (let c = 0; c < VIEWPORT_COLS; c++) {
        html += `<th>${indexToColName(viewportStartCol + c)}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (let r = 0; r < VIEWPORT_ROWS; r++) {
        let actualRow = viewportStartRow + r;
        html += `<tr><td class="row-num">${actualRow}</td>`;
        for (let c = 0; c < VIEWPORT_COLS; c++) {
            const cellId = `${indexToColName(viewportStartCol + c)}${actualRow}`;
            html += `<td data-row="${r}" data-col="${c}" onmousedown="handleSelectionStart(event, ${r}, ${c})" onmouseenter="handleSelectionMove(event, ${r}, ${c})"><input type="text" id="cell-${cellId}" data-cell="${cellId}" autocomplete="off"
                        onfocus="handleFocus(this)" 
                        onblur="updateCell(this)" 
                        oninput="handleInput(this)"
                        onkeydown="handleExcelKey(event, ${r}, ${c})"></td>`;
        }
        html += '</tr>';
    }
    html += '</tbody>';
    grid.innerHTML = html;

    // Crea el menú desplegable de autocompletado si no existe
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
        parent.removeEventListener('paste', handlePaste);
        parent.addEventListener('paste', handlePaste);
    }

    if (historyStack.length === 0) pushToHistory();
    setTimeout(recomputeAll, 50);
}

// Atajos globales para Excel
window.addEventListener('keydown', (e) => {
    const view = document.getElementById('view-budgets');
    if (!view.classList.contains('active')) return;

    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            document.activeElement.blur(); // Asegurar que se guarde el cambio actual antes de deshacer
        }
        undo();
    }
    if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
    }
});

function renderGridViewport() {
    const grid = document.getElementById('excel-grid');
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


async function fetchSpreadsheet() {
    try {
        const res = await fetch('/api/spreadsheet?token=' + TOKEN);
        spreadsheetData = await res.json();
        historyStack = []; historyIndex = -1;
        selectionStart = selectionEnd = null;
        pushToHistory();
        createExcelGrid();
    } catch (e) { console.error("Error fetching spreadsheet:", e); }
}

async function saveSpreadsheet() {
    const status = document.getElementById('excel-status');
    status.style.display = 'inline';
    status.textContent = 'Guardando...';
    try {
        await fetch('/api/spreadsheet?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ name: 'Principal', content: spreadsheetData })
        });
        status.textContent = 'Guardado';
        setTimeout(() => status.style.display = 'none', 2000);
    } catch (e) {
        status.textContent = 'Error al guardar ❌';
    }
}

let activeFormulaInput = null;

window.addEventListener('mouseup', () => {
    isSelecting = false;
});

function handleFocus(input) {
    const cellId = input.dataset.cell;
    input.value = spreadsheetData[cellId] || '';
    activeFormulaInput = input;
    document.getElementById('formula-bar-label').textContent = cellId;
    document.getElementById('formula-bar-input').value = input.value;
}

function handleFormulaBarInput(e) {
    if (activeFormulaInput) {
        activeFormulaInput.value = e.target.value;
        handleInput(activeFormulaInput);
    }
}

function handleFormulaBarKey(e) {
    if (activeFormulaInput) {
        if (e.key === 'Enter') updateCell(activeFormulaInput);
    }
}

function handleFormulaBarBlur() {
    // Función de limpieza para cuando se pierde el foco de la barra de fórmulas
    setTimeout(() => {
        const ac = document.getElementById('excel-autocomplete');
        if (ac) ac.style.display = 'none';
    }, 200);
}

function updateCell(input) {
    setTimeout(() => { document.getElementById('excel-autocomplete').style.display = 'none'; }, 200);
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

function handleInput(input) {
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
                onmousedown="selectAutocomplete('${item}')">${item}</div>`
    ).join('');
}

function selectAutocomplete(funcName) {
    const input = document.activeElement;
    if (input && input.tagName === 'INPUT') {
        let val = input.value;
        let lastEq = val.lastIndexOf('=');
        input.value = val.substring(0, lastEq + 1) + funcName + '(';
        document.getElementById('excel-autocomplete').style.display = 'none';
        input.focus();
    }
}

function handleExcelKey(e, row, col) {
    const ac = document.getElementById('excel-autocomplete');
    let isEditingFormula = document.activeElement && document.activeElement.id === 'formula-bar-input';

    if (e.key === 'Delete' && selectionStart && selectionEnd && !isEditingFormula) {
        let changed = false;
        const minR = Math.min(selectionStart.row, selectionEnd.row), maxR = Math.max(selectionStart.row, selectionEnd.row);
        const minC = Math.min(selectionStart.col, selectionEnd.col), maxC = Math.max(selectionStart.col, selectionEnd.col);
        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                const id = `${indexToColName(viewportStartCol + c)}${viewportStartRow + r}`;
                if (spreadsheetData[id]) { delete spreadsheetData[id]; changed = true; }
            }
        }
        if (changed) { pushToHistory(); recomputeAll(); renderGridViewport(); saveSpreadsheet(); }
        return;
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

if (typeof window.originalShowView === 'undefined') {
    window.originalShowView = window.showView;
}
window.showView = function (viewId) {
    if (viewId === 'budgets') fetchSpreadsheet();
    if (typeof window.originalShowView === 'function') window.originalShowView(viewId);
};

function togglePythonPanel() {
    const panel = document.getElementById('python-panel');
    panel.style.display = (panel.style.display === 'none' || panel.style.display === '') ? 'block' : 'none';
}

async function runPythonScript() {
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
        const res = await fetch('/api/spreadsheet/run-python?token=' + TOKEN, {
            method: 'POST',
            headers: HEADERS,
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
    const minR = Math.min(selectionStart.row, selectionEnd.row);
    const maxR = Math.max(selectionStart.row, selectionEnd.row);
    const minC = Math.min(selectionStart.col, selectionEnd.col);
    const maxC = Math.max(selectionStart.col, selectionEnd.col);
    return r >= minR && r <= maxR && c >= minC && c <= maxC;
}

function handleSelectionStart(e, r, c) {
    if (e.target.tagName === 'INPUT' && document.activeElement === e.target) return; // Allow interaction if already focused

    isSelecting = true;
    selectionStart = { row: r, col: c };
    selectionEnd = { row: r, col: c };
    renderGridViewport();
}

function handleSelectionMove(e, r, c) {
    if (!isSelecting) return;
    selectionEnd = { row: r, col: c };
    renderGridViewport();
}

window.addEventListener('mouseup', () => {
    isSelecting = false;
});

function handlePaste(e) {
    const active = document.activeElement;
    if (!active || !active.dataset.cell) return;

    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text) return;

    const rows = text.split(/\r?\n/);
    const startCellId = active.dataset.cell;
    const startColMatch = startCellId.match(/^[A-Z]+/)[0];
    const startCol = colNameToIndex(startColMatch);
    const startRow = parseInt(startCellId.match(/\d+$/)[0]);

    let changed = false;
    rows.forEach((rowText, rowIndex) => {
        if (!rowText.trim() && rowIndex === rows.length - 1) return;
        const cols = rowText.split('\t');
        cols.forEach((colText, colIndex) => {
            const cellId = `${indexToColName(startCol + colIndex)}${startRow + rowIndex}`;
            spreadsheetData[cellId] = colText;
            changed = true;
        });
    });

    if (changed) {
        pushToHistory();
        recomputeAll();
        renderGridViewport();
        saveSpreadsheet();
    }
}

// --- Autocomplete Python ---
const PYTHON_KEYWORDS = [
    'set_cell', 'get_cell', 'clear_all', 'math', 'datetime', 'range', 'print',
    'for', 'in', 'if', 'else', 'elif', 'while', 'def', 'return', 'import', 'math.pow', 'math.sqrt',
    'datetime.datetime.now'
];
let pyAcIndex = 0;
let pyAcItems = [];

function handlePythonInput(e) {
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

function handlePythonKey(e) {
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
    // Posicionamiento básico (cerca del botón ejecutar para no tapar)
    const rect = textarea.getBoundingClientRect();
    ac.style.left = `20px`;
    ac.style.bottom = `80px`;
    ac.style.display = 'block';
    renderPythonAc();
}

function renderPythonAc() {
    const ac = document.getElementById('python-autocomplete');
    ac.innerHTML = pyAcItems.map((item, i) => `
        <div onclick="selectPythonAc('${item}')" style="padding: 8px 12px; font-size: 0.75rem; color: ${i === pyAcIndex ? '#fff' : 'var(--text-muted)'}; background: ${i === pyAcIndex ? 'var(--indigo)' : 'transparent'}; cursor: pointer; font-family: monospace;">
            ${item}
        </div>
    `).join('');
}

function selectPythonAc(word) {
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

function exportSpreadsheet() {
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
    a.download = `excel_export_${new Date().getTime()}.nvx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSpreadsheet(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            // Validar si es nuestro formato o un JSON plano
            const content = data.content ? data.content : data;

            if (typeof content !== 'object') throw new Error("Formato inválido");

            spreadsheetData = content;
            pushToHistory();
            recomputeAll();
            renderGridViewport();
            saveSpreadsheet();
            alert("✅ Archivo importado correctamente.");
        } catch (err) {
            console.error(err);
            alert("❌ Error al importar el archivo: Formato no válido.");
        }
        event.target.value = ''; // Limpiar input
    };
    reader.readAsText(file);
}
