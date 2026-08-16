export async function fetchModels() {
    try {
        const r = await fetch('/api/ai/models');
        const data = await r.json();
        return data.models || [];
    } catch (e) { return []; }
}

export async function loadCloudItemsForAttach() {
    const listEl = document.getElementById('attach-selector-list');
    const pathContainer = document.getElementById('attach-selector-path-container');

    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);">Cargando archivos de la nube...</div>';

    // Render breadcrumbs / back button
    if (selectModalCloudPath) {
        pathContainer.style.display = 'block';
        pathContainer.innerHTML = `
                    <button class="attach-selector-back-btn" onclick="navigateSelectModalCloudUp()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        Carpeta Anterior (/${selectModalCloudPath})
                    </button>
                `;
    } else {
        pathContainer.style.display = 'none';
        pathContainer.innerHTML = '';
    }

    try {
        const response = await fetch(`/api/cloud/files?view=drive&path=${encodeURIComponent(selectModalCloudPath)}`);
        if (!response.ok) throw new Error('Error al cargar archivos');
        const data = await response.json();

        const files = data.files || [];
        selectorAllItems = files;
        renderAttachSelectorItems(files);
    } catch (err) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:#f87171;">Error: ${err.message}</div>`;
    }
}

export function loadNotesItemsForAttach() {
    const pathContainer = document.getElementById('attach-selector-path-container');
    pathContainer.style.display = 'none';
    pathContainer.innerHTML = '';

    // Get notes from localStorage variable 'notes'
    const formattedNotes = notes.map(note => ({
        id: note.id,
        name: note.title || 'Nota sin título',
        is_note: true,
        content: note.content || '',
        updatedAt: note.updatedAt || new Date().toISOString()
    }));

    selectorAllItems = formattedNotes;
    renderAttachSelectorItems(formattedNotes);
}

export function loadKnowledgeItemsForAttach() {
    const pathContainer = document.getElementById('attach-selector-path-container');
    pathContainer.style.display = 'none';
    pathContainer.innerHTML = '';

    // Mock knowledge base articles
    const mockKnowledge = [
        {
            name: 'Manual_Null_Void_Engine.md',
            is_knowledge: true,
            description: 'Manual de usuario oficial del motor de base de datos local-first y la arquitectura descentralizada.',
            content: `# Manual de Usuario - Null-Void Engine\\n\\nNull-Void Engine es un motor de base de datos local-first diseñado para proporcionar almacenamiento offline y sincronización en tiempo real...\\n`
        },
        {
            name: 'Guia_Desarrollo_Modulos.md',
            is_knowledge: true,
            description: 'Guía técnica para programadores sobre cómo extender la suite Null-Void y escribir plugins personalizados.',
            content: `# Guía de Desarrollo de Módulos - Null-Void Engine\\n\\nPara desarrollar un nuevo módulo en la plataforma, debes registrar la ruta en el sistema y exportar la interfaz DOM...\\n`
        },
        {
            name: 'Politica_Privacidad_LocalFirst.md',
            is_knowledge: true,
            description: 'Políticas oficiales sobre la privacidad de los datos, el cifrado local y los principios descentralizados.',
            content: `# Política de Privacidad y Filosofía Local-First\\n\\nTodos los datos introducidos en el sistema de chat y nube son privados, se almacenan localmente y se transmiten utilizando TLS/SSL...\\n`
        }
    ];

    selectorAllItems = mockKnowledge;
    renderAttachSelectorItems(mockKnowledge);
}

export async function searchHuggingFace() {
    const query = document.getElementById('hf-search-input').value.trim();
    if (!query) return;
    const resultsContainer = document.getElementById('hf-results-container');
    resultsContainer.style.display = 'block';
    resultsContainer.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-dim);font-size:0.8rem;">Buscando en Hugging Face...</div>';

    resultsContainer.innerHTML = '<div style="padding:10px;text-align:center;color:#f87171;font-size:0.85rem;font-weight:bold;">Búsqueda en la nube desactivada por privacidad (Modo Local Estricto).<br><span style="color:var(--text-dim);font-weight:normal;font-size:0.75rem;">Usa el comando manual si necesitas un modelo.</span></div>';

}

export async function fetchAPIKeys() {
    try {
        const r = await fetch('/api/ai/keys');
        const data = await r.json();
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

export async function saveAPIKey(provider, apiKey, apiUrl, model) {
    try {
        const r = await fetch('/api/ai/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, api_key: apiKey, api_url: apiUrl, model: model || null })
        });
        const data = await r.json();
        return data.ok === true || data.ok;
    } catch (e) { return false; }
}

export async function deleteAPIKey(provider) {
    try {
        const r = await fetch('/api/ai/keys', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });
        const data = await r.json();
        return data.ok === true || data.ok;
    } catch (e) { return false; }
}
