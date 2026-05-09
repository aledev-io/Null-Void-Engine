async function handleInvoiceFileChange(input) {
    const file = input.files[0];
    if (!file) return;

    const consoleOutput = document.getElementById('invoice-console-output');
    if (!consoleOutput) return;

    // Feedback inmediato y limpieza
    consoleOutput.style.color = '#00ff00';
    consoleOutput.textContent = `> [SISTEMA] Archivo seleccionado: ${file.name}\n`;
    consoleOutput.textContent += `> [SISTEMA] Tamaño: ${(file.size / 1024).toFixed(2)} KB\n`;
    consoleOutput.textContent += `> [SISTEMA] Iniciando extracción de datos...\n`;

    if (file.type !== 'application/pdf') {
        consoleOutput.textContent += `> [ERROR] El archivo debe ser un PDF.\n`;
        consoleOutput.style.color = '#ff5f56';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        consoleOutput.textContent += `> [SISTEMA] Procesando en servidor con Poppler Engine...\n`;

        const res = await fetch('/api/invoices/upload?token=' + (typeof TOKEN !== 'undefined' ? TOKEN : ''), {
            method: 'POST',
            body: formData
        });

        const data = await res.json();

        if (data.ok) {
            consoleOutput.textContent += `> [SISTEMA] ¡EXTRACCIÓN COMPLETADA! ✅\n`;
            consoleOutput.textContent += `--------------------------------------\n`;
            consoleOutput.textContent += data.text;
            consoleOutput.scrollTop = 0;
        } else {
            consoleOutput.textContent += `> [ERROR DEL MOTOR] ${data.error}\n`;
            consoleOutput.style.color = '#ff5f56';
        }
    } catch (err) {
        consoleOutput.textContent += `> [ERROR CRÍTICO] No se pudo contactar con el servidor.\n`;
        consoleOutput.style.color = '#ff5f56';
        console.error(err);
    } finally {
        input.value = '';
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('invoice-drop-zone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--indigo)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--border)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        const file = e.dataTransfer.files[0];
        if (file) {
            // Creamos un objeto simulado para reutilizar la lógica
            const mockInput = { files: [file], value: '' };
            handleInvoiceFileChange(mockInput);
        }
    });
});
