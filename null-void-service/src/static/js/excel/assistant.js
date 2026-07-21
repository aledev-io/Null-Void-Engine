/**
 * Agente Asistente Basado en Reglas y Estado
 * Gestiona el flujo conversacional con input de texto
 */

(function () {
    const chatHistory = document.getElementById('assistant-chat-history');
    const optionsContainer = document.getElementById('assistant-options');
    const textInput = document.getElementById('assistant-text-input');
    const sendBtn = document.getElementById('assistant-send-btn');

    let context = {
        name: '',
        cost: '',
        margin: '',
        discounts: ''
    };

    let currentState = 'IDLE';

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g,
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    function parseMarkdown(text) {
        let html = escapeHTML(text);
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function addBotMessage(text) {
        if (!chatHistory) return;
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = `
            background: rgba(99, 102, 241, 0.1);
            border: 1px solid var(--border);
            padding: 10px 12px;
            border-radius: 8px 8px 8px 0;
            color: var(--text-main);
            align-self: flex-start;
            max-width: 90%;
            line-height: 1.4;
            word-break: break-word;
            overflow-wrap: break-word;
        `;
        msgDiv.innerHTML = parseMarkdown(text);
        chatHistory.appendChild(msgDiv);
        scrollToBottom();
    }

    function addUserMessage(text) {
        if (!chatHistory) return;
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = `
            background: linear-gradient(135deg, var(--indigo), #4f46e5);
            color: white;
            padding: 10px 12px;
            border-radius: 8px 8px 0 8px;
            align-self: flex-end;
            max-width: 90%;
            line-height: 1.4;
            word-break: break-word;
            overflow-wrap: break-word;
        `;
        msgDiv.textContent = text;
        chatHistory.appendChild(msgDiv);
        scrollToBottom();
    }

    function renderOptions(options) {
        if (!optionsContainer) return;
        optionsContainer.innerHTML = '';
        if (options.length === 0) return;

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.textContent = opt.label;

            btn.style.cssText = `
                background: var(--surface-hi);
                border: 1px solid var(--border);
                color: var(--text-main);
                padding: 8px 12px;
                border-radius: 6px;
                font-size: var(--font-sm);
                cursor: pointer;
                transition: all 0.2s;
                text-align: left;
            `;

            btn.onmouseover = () => {
                btn.style.background = 'rgba(255, 255, 255, 0.05)';
                btn.style.borderColor = 'var(--indigo)';
            };
            btn.onmouseout = () => {
                btn.style.background = 'var(--surface-hi)';
                btn.style.borderColor = 'var(--border)';
            };

            btn.onclick = () => {
                handleUserInput(opt.label, opt.actionId);
            };

            optionsContainer.appendChild(btn);
        });
        setTimeout(scrollToBottom, 10);
    }

    function scrollToBottom() {
        if (chatHistory) chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function processText(text) {
        if (!text || text.trim() === '') return;
        handleUserInput(text.trim());
    }

    if (sendBtn && textInput) {
        sendBtn.onclick = () => {
            processText(textInput.value);
            textInput.value = '';
        };
        textInput.onkeypress = (e) => {
            if (e.key === 'Enter') {
                processText(textInput.value);
                textInput.value = '';
            }
        };
    }

    function updateInputVisibility() {
        const textArea = document.getElementById('assistant-text-area');
        if (!textArea) return;

        // Mostrar input de texto solo en los estados donde pedimos datos
        const textStates = ['ASK_NAME', 'ASK_COST', 'ASK_INTERNET_PRICE', 'ASK_MARGIN', 'ASK_DISCOUNTS'];
        if (textStates.includes(currentState)) {
            textArea.style.display = 'flex';
            setTimeout(scrollToBottom, 10);
        } else {
            textArea.style.display = 'none';
        }
    }

    // ==========================================
    // MÁQUINA DE ESTADOS DEL ASISTENTE
    // ==========================================

    function handleUserInput(text, actionId = null) {
        addUserMessage(text);
        optionsContainer.innerHTML = ''; // Ocultar botones

        // Ocultar la barra si acabamos de enviar algo
        const textArea = document.getElementById('assistant-text-area');
        if (textArea) textArea.style.display = 'none';

        setTimeout(() => {
            if (currentState === 'IDLE') {
                if (actionId === 'template_upload') {
                    const fileInput = document.getElementById('import-file');
                    if (fileInput) fileInput.click();
                    addBotMessage("Por favor, selecciona el archivo de la factura. Una vez subido, cargaré la información en la tabla automáticamente.");
                    renderOptions([{ label: "Volver al inicio", actionId: "home" }]);
                } else if (actionId === 'template_empty') {
                    if (typeof window.applyBillingCalculatorUI === 'function') {
                        document.getElementById('billing-ui-name').value = '';
                        document.getElementById('billing-ui-cost').value = '';
                        document.getElementById('billing-ui-margin').value = '';
                        document.getElementById('billing-ui-discounts').value = '';
                        window.applyBillingCalculatorUI();
                    }
                    currentState = 'ASK_ADD_PRODUCT';
                    addBotMessage("Plantilla base generada. ¿Quieres añadir un producto para empezar a usarla?");
                    renderOptions([
                        { label: "Sí, vamos a añadirlo", actionId: "yes" },
                        { label: "No, la llenaré yo a mano", actionId: "no" }
                    ]);
                } else if (actionId === 'quick_calc') {
                    if (typeof window.quickCalcCounter === 'undefined') {
                        window.quickCalcCounter = 0;
                    }
                    const letter = String.fromCharCode(65 + (window.quickCalcCounter % 26));
                    context.name = "Producto " + letter;
                    window.quickCalcCounter++;

                    currentState = 'ASK_COST';
                    addBotMessage(`Iniciando cálculo rápido para "${context.name}". Para empezar, ¿cuál es tu coste base o de compra? (Dime el número en €)`);
                    updateInputVisibility();
                } else if (actionId === 'explain') {
                    currentState = 'ASK_EXPLAIN_TYPE';
                    addBotMessage("Claro, te ayudaré a no perder dinero en tus presupuestos eléctricos. ¿Qué tipo de concepto vamos a presupuestar?");
                    renderOptions([
                        { label: "Material Eléctrico (Cuadros, cables, mecanismos)", actionId: "material" },
                        { label: "Mano de Obra (Horas de instalación)", actionId: "horas" },
                        { label: "Desplazamiento / Urgencia", actionId: "viaje" }
                    ]);
                } else if (actionId === 'clear') {
                    if (typeof window.executeClearSpreadsheet === 'function') {
                        window.executeClearSpreadsheet();
                    }
                    addBotMessage("Tabla limpiada por completo. ¿Qué más quieres hacer?");
                    startFlow(false);
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_EXPLAIN_TYPE') {
                let explanation = "";
                if (actionId === 'material') {
                    explanation = `**Analizando Material Eléctrico...** Para no pillarte los dedos, mira estas dimensiones:
1. **Mermas y Sobrantes**: Siempre vas a gastar más tubo o cable del medido. Repercute un 10-15% extra en el presupuesto.
2. **Margen de Gestión**: Si compras un magnetotérmico a 10€ en el almacén, nunca lo vendas a 10€. Cóbralo a 13€ o 15€; el cliente te paga por saber qué comprar y por ir a buscarlo.
3. **Riesgo de Garantía**: Si una luminaria sale defectuosa, tendrás que ir a cambiarla y perder tu tiempo. Ese riesgo se cubre con el margen del material.`;
                } else if (actionId === 'horas') {
                    explanation = `**Analizando Mano de Obra...** Tu hora de trabajo es tu activo más valioso:
1. **Tiempos Muertos**: No cobres solo el tiempo "atornillando". Cuenta el tiempo de cargar la furgoneta, buscar la avería y limpiar al terminar.
2. **Coste de Oportunidad**: Si cobras muy barato este trabajo, estás perdiendo dinero que ganarías en una obra mejor pagada.
3. **Imprevistos**: Un tabique duro, cables viejos sin tubo... Añade siempre un 20% de tiempo extra de seguridad en el presupuesto.`;
                } else {
                    explanation = `**Analizando Desplazamientos y Urgencias...** Esto es puro gasto si no lo controlas:
1. **Coste Real del Vehículo**: No es solo gasoil. Es el seguro, la ITV, el desgaste de las ruedas de la furgoneta y los parkings.
2. **Tiempo de Viaje**: Una hora en un atasco es una hora que no estás montando cuadros. Hay que cobrarla (como tarifa de desplazamiento).
3. **Plus de Urgencia**: Trabajos fuera de horario o sin aviso previo deben llevar un recargo mínimo del 50% al 100%. Tu disponibilidad vale dinero.`;
                }
                addBotMessage(explanation);

                setTimeout(() => {
                    currentState = 'ASK_EXPLAIN_DECISION';
                    addBotMessage("¿Quieres que hagamos un cálculo de rentabilidad exacto para este concepto (meter tu coste y ver a cuánto facturarlo)?");
                    renderOptions([
                        { label: "Sí, calcular rentabilidad", actionId: "yes" },
                        { label: "No, gracias", actionId: "no" }
                    ]);
                }, 800);
            } else if (currentState === 'ASK_EXPLAIN_DECISION') {
                if (actionId === 'yes') {
                    currentState = 'ASK_NAME';
                    addBotMessage("¡Perfecto! Vamos allá. Dime, ¿cómo se llama el producto que quieres añadir?");
                } else {
                    startFlow(false);
                }
            } else if (currentState === 'ASK_ADD_PRODUCT') {
                const answer = text.toLowerCase();
                if (actionId === 'yes' || answer.includes('si') || answer.includes('sí') || answer.includes('claro')) {
                    currentState = 'ASK_NAME';
                    addBotMessage("¡Perfecto! Vamos allá. Dime, ¿cómo se llama el producto que quieres añadir?");
                } else if (actionId === 'no' || answer.includes('no')) {
                    currentState = 'IDLE';
                    addBotMessage("De acuerdo. Si necesitas algo más, aquí estoy.");
                    startFlow(false);
                } else {
                    addBotMessage("No te he entendido del todo. ¿Quieres añadir un producto ahora? (Responde Sí o No)");
                }
            } else if (currentState === 'ASK_NAME') {
                let name = text.trim();
                if (/^\d/.test(name)) {
                    addBotMessage("El nombre del producto no puede empezar por un número. Por favor, escribe un nombre válido (letras primero):");
                    updateInputVisibility();
                    return;
                }
                if (!/^[a-zA-Z0-9\s\-_.\u00C0-\u017F]+$/.test(name)) {
                    addBotMessage("El nombre contiene símbolos no permitidos. Por favor, usa solo letras, números, espacios o guiones:");
                    updateInputVisibility();
                    return;
                }
                if (name.length > 40) {
                    addBotMessage("El nombre es demasiado largo. Por favor, usa un nombre más corto (máximo 40 caracteres):");
                    updateInputVisibility();
                    return;
                }
                context.name = name;
                currentState = 'ASK_COST';
                addBotMessage(`Genial. Para calcular esto bien, ¿cuál es tu coste base o de producción para ${context.name}? (Dime el número en €)`);
            } else if (currentState === 'ASK_COST') {
                let costStr = text.replace(/[^0-9.,-]/g, '').replace(',', '.');
                let parsedCost = parseFloat(costStr);
                const MIN_COST = 0.50;
                if (isNaN(parsedCost) || parsedCost < MIN_COST) {
                    addBotMessage(`Ese coste parece demasiado bajo o inválido. Por favor, introduce un coste operativo mínimo de ${MIN_COST}€:`);
                    updateInputVisibility();
                    return;
                }
                context.cost = parsedCost;
                currentState = 'ASK_INTERNET_PRICE';
                addBotMessage(`Perfecto, tu coste es ${parsedCost}€. Para ser competitivos y ayudarte a fijar un buen margen, ¿a qué precio se suele vender esto en internet o en la competencia aprox.?`);
            } else if (currentState === 'ASK_INTERNET_PRICE') {
                let internetPriceStr = text.replace(/[^0-9.,-]/g, '').replace(',', '.');
                let internetPrice = parseFloat(internetPriceStr);
                const MAX_COMPETITIVE_PRICE = 50000;
                if (isNaN(internetPrice) || internetPrice <= 0 || internetPrice > MAX_COMPETITIVE_PRICE) {
                    addBotMessage(`El precio introducido es inválido o supera el límite de ${MAX_COMPETITIVE_PRICE}€. Por favor, introduce un precio de mercado realista:`);
                    updateInputVisibility();
                    return;
                }

                let cost = context.cost;
                let targetPrice;
                let suggestedMargin;
                let messageToUser = "";

                if (internetPrice < cost) {
                    // Situación Crítica: Fuera de Mercado
                    let survivalMargin = 20; // Margen mínimo de supervivencia
                    targetPrice = cost / (1 - (survivalMargin / 100));
                    context.recommendedMargin = survivalMargin;

                    messageToUser = `¡Cuidado! Tu coste operativo (${cost}€) es MAYOR que el precio de venta de la competencia (${internetPrice}€). Estás fuera de mercado en precio puro.\n\nLa única forma de ser rentable es no competir por precio, sino aportar valor extra (ej. venderlo con instalación incluida o como servicio garantizado). Te sugiero aplicar un margen de supervivencia del ${survivalMargin}% y venderlo a ${Math.round(targetPrice)}€. ¿Te aplico este margen o prefieres fijar tú otro (%)?`;
                } else {
                    // Reglas ESTRICTAS de márgenes mínimos para instaladores profesionales
                    let minMargin;
                    if (cost <= 10) {
                        minMargin = 60; // Material menudo (cables, mecanismos) necesita mucho margen
                    } else if (cost <= 50) {
                        minMargin = 40; // Material estándar (magnetotérmicos)
                    } else if (cost <= 100) {
                        minMargin = 30; // Material medio (luminarias)
                    } else if (cost <= 300) {
                        minMargin = 25; // Material caro (cuadros preensamblados)
                    } else {
                        minMargin = 20; // Equipos grandes (baterías, inversores)
                    }

                    // En un negocio de servicios no se compite a la baja con Internet.
                    // El profesional aporta garantía e inmediatez: el precio "competitivo" es un 5% por encima de Internet.
                    let competitivePrice = internetPrice * 1.05;
                    let competitiveMargin = ((competitivePrice - cost) / competitivePrice) * 100;

                    if (competitiveMargin < minMargin) {
                        // La competencia vende barato, aplicar regla estricta de protección de negocio
                        targetPrice = cost / (1 - (minMargin / 100));

                        // Límite de sentido común MUCHO más amplio (el cliente paga el servicio, no solo el material):
                        // Material hasta 50€: se puede cobrar hasta el DOBLE que en internet sin que se quejen.
                        // Material medio: hasta un 60% más.
                        // Material muy caro: tope de un 30% más para no asustar.
                        let maxPremiumMultiplier;
                        if (internetPrice <= 50) maxPremiumMultiplier = 2.00;
                        else if (internetPrice <= 150) maxPremiumMultiplier = 1.60;
                        else maxPremiumMultiplier = 1.30;

                        let maxReasonablePrice = internetPrice * maxPremiumMultiplier;

                        if (targetPrice > maxReasonablePrice) {
                            targetPrice = maxReasonablePrice;
                        }

                        // Recalcular el margen real tras aplicar el tope comercial
                        suggestedMargin = ((targetPrice - cost) / targetPrice) * 100;

                        // Salvar los muebles con un 10% absoluto
                        if (suggestedMargin <= 0) {
                            suggestedMargin = 10;
                            targetPrice = cost * 1.10;
                        }

                        context.recommendedMargin = Math.round(suggestedMargin);

                        messageToUser = `La competencia está a ${internetPrice}€, pero igualar ese precio con tu coste de ${cost}€ arruina tu rentabilidad operativa.\n\nSiguiendo reglas estrictas de instalación, te protejo con un margen del ${context.recommendedMargin}%, situando tu precio en unos ${Math.round(targetPrice)}€. ¿Te aplico este margen o prefieres escribir tú otro (%)?`;
                    } else {
                        // Podemos competir y tenemos margen de sobra
                        suggestedMargin = competitiveMargin;
                        targetPrice = competitivePrice;
                        context.recommendedMargin = Math.round(suggestedMargin);

                        messageToUser = `Tienes margen de maniobra excelente frente a los ${internetPrice}€ de internet. Como profesional aportas inmediatez y garantía, así que te sugiero un precio de ${Math.round(targetPrice)}€ (un 5% sobre internet).\n\nEsto te consolida un margen muy sano del ${context.recommendedMargin}%. ¿Te aplico este margen o prefieres escribir tú otro (%)?`;
                    }
                }

                currentState = 'ASK_MARGIN';
                addBotMessage(messageToUser);
            } else if (currentState === 'ASK_MARGIN') {
                const answer = text.toLowerCase();
                let finalMargin = context.recommendedMargin;

                if (answer.includes('si') || answer.includes('sí') || answer.includes('ok') || answer.includes('vale') || answer.includes('aplica')) {
                    finalMargin = context.recommendedMargin;
                } else {
                    let marginStr = text.replace(/[^0-9.,-]/g, '').replace(',', '.');
                    let parsedMargin = parseFloat(marginStr);
                    if (!isNaN(parsedMargin) && parsedMargin >= 0) {
                        finalMargin = parsedMargin;
                    } else {
                        addBotMessage("No he entendido el margen. Escribe el número (%) o dime 'sí' para usar el sugerido:");
                        updateInputVisibility();
                        return;
                    }
                }
                context.margin = finalMargin.toString();
                currentState = 'ASK_DISCOUNTS';
                addBotMessage(`Margen fijado al ${finalMargin}%. Por último, dime si quieres aplicar distintos descuentos para simular precios (Ej: 0 5 10 20). Si no quieres, pon 0.`);
            } else if (currentState === 'ASK_DISCOUNTS') {
                let discountsArray = text.split(/[\s,-]+/).map(s => parseFloat(s.replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n) && n >= 0);

                if (discountsArray.length > 5) {
                    addBotMessage("Por favor, limita los descuentos a un máximo de 5 valores para no saturar la visualización de la tabla. Escríbelos de nuevo:");
                    updateInputVisibility();
                    return;
                }

                let normalizedDiscounts = discountsArray.join(', ');
                context.discounts = normalizedDiscounts || "0";

                let finalPrice = context.cost / (1 - (parseFloat(context.margin) / 100));

                currentState = 'ASK_CONFIRMATION';
                addBotMessage(`**Modo Auditoría - Resumen de Confirmación:**\n\n- **Producto**: ${context.name}\n- **Coste Operativo**: ${context.cost}€\n- **Margen**: ${context.margin}%\n- **Precio Final Estimado**: ${Math.round(finalPrice)}€\n- **Descuentos**: ${context.discounts}%\n\n¿Es todo correcto?`);
                renderOptions([
                    { label: "Confirmar y Generar Tabla", actionId: "confirm" },
                    { label: "Corregir datos", actionId: "restart" }
                ]);
            } else if (currentState === 'ASK_CONFIRMATION') {
                if (actionId === 'confirm' || text.toLowerCase().includes('si') || text.toLowerCase().includes('sí')) {
                    addBotMessage("¡Todo validado! Dame un segundo, voy a actualizar la tabla automáticamente con estos datos...");

                    setTimeout(() => {
                        if (document.getElementById('billing-ui-name')) document.getElementById('billing-ui-name').value = context.name;
                        if (document.getElementById('billing-ui-cost')) document.getElementById('billing-ui-cost').value = context.cost.toString();
                        if (document.getElementById('billing-ui-margin')) document.getElementById('billing-ui-margin').value = context.margin;
                        if (document.getElementById('billing-ui-discounts')) document.getElementById('billing-ui-discounts').value = context.discounts;

                        if (typeof window.applyBillingCalculatorUI === 'function') {
                            window.applyBillingCalculatorUI();
                        } else {
                            addBotMessage("Vaya, hubo un error técnico actualizando la tabla.");
                        }

                        currentState = 'IDLE';
                        startFlow(false);
                    }, 1000);
                } else {
                    addBotMessage("Operación cancelada. Vamos a empezar de nuevo.");
                    setTimeout(() => {
                        startFlow(true);
                    }, 1000);
                }
            }

            updateInputVisibility();

        }, 500); // Simulamos tiempo de pensamiento
    }

    function startFlow(showMessage = true) {
        currentState = 'IDLE';
        if (showMessage) {
            if (chatHistory) chatHistory.innerHTML = '';
            addBotMessage("¡Hola! Soy tu asistente de presupuestos. Estoy aquí para generar facturas, calcular márgenes de materiales y tarifas por hora para tus instalaciones eléctricas. ¿Qué quieres hacer?");
        }
        renderOptions([
            { label: "Crear plantilla a partir de factura subida", actionId: "template_upload" },
            { label: "Crear plantilla sin factura", actionId: "template_empty" },
            { label: "Cálculo rápido (Producto A, B...)", actionId: "quick_calc" },
            { label: "Explicar qué interesa evaluar para X producto", actionId: "explain" },
            { label: "Limpiar toda la tabla", actionId: "clear" }
        ]);
        updateInputVisibility();
    }

    document.addEventListener("DOMContentLoaded", () => {
        startFlow();
    });

})();
