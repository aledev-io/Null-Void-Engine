(function () {
    const chatHistory = document.getElementById('assistant-chat-history');
    const optionsContainer = document.getElementById('assistant-options');
    const textInput = document.getElementById('assistant-text-input');
    const sendBtn = document.getElementById('assistant-send-btn');

    let context = {};
    let currentState = 'IDLE';

    const TEXT_STATES = ['ASK_SEARCH_QUERY', 'ASK_REF_ADDRESS', 'ASK_BOT_RULE_NAME', 'ASK_BOT_MAX_PRICE', 'ASK_BOT_MIN_SURFACE', 'ASK_BOT_KEYWORDS', 'ASK_BOT_MAX_DISTANCE', 'ASK_BOT_AVAIL_DATE', 'ASK_FILTER_NAME', 'ASK_FILTER_ADDRESS', 'ASK_FILTER_MAX_DIST', 'ASK_FILTER_MIN_PRICE', 'ASK_FILTER_MAX_PRICE', 'ASK_FILTER_AVAIL_DATE'];

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g,
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
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
            background: rgba(168, 85, 247, 0.08);
            border: 1px solid rgba(168, 85, 247, 0.2);
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
            background: linear-gradient(135deg, #6366f1, #a855f7);
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
            btn.onmouseover = () => { btn.style.background = 'rgba(168, 85, 247, 0.1)'; btn.style.borderColor = '#a855f7'; };
            btn.onmouseout = () => { btn.style.background = 'var(--surface-hi)'; btn.style.borderColor = 'var(--border)'; };
            btn.onclick = () => { handleUserInput(opt.label, opt.actionId); };
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
        sendBtn.onclick = () => { processText(textInput.value); textInput.value = ''; };
        textInput.onkeypress = (e) => {
            if (e.key === 'Enter') { processText(textInput.value); textInput.value = ''; }
        };
    }

    function updateInputVisibility() {
        const textArea = document.getElementById('assistant-text-area');
        if (!textArea) return;
        if (TEXT_STATES.includes(currentState)) {
            textArea.style.display = 'flex';
            setTimeout(scrollToBottom, 10);
        } else {
            textArea.style.display = 'none';
        }
    }

    async function fetchAPI(url, options = {}) {
        const token = document.cookie.match(/(?:^|;\s*)token=([^;]*)/)?.[1] || '';
        const headers = { 'X-Token': token, 'Content-Type': 'application/json', ...options.headers };
        try {
            const res = await fetch(url, { ...options, headers });
            if (res.status === 401 || res.status === 403) {
                addBotMessage("Your session has expired. Please reload the page.");
                return null;
            }
            return await res.json();
        } catch (e) {
            addBotMessage("Connection error: " + e.message);
            return null;
        }
    }

    function handleUserInput(text, actionId = null) {
        addUserMessage(text);
        if (optionsContainer) optionsContainer.innerHTML = '';
        const textArea = document.getElementById('assistant-text-area');
        if (textArea) textArea.style.display = 'none';

        setTimeout(async () => {
            if (!actionId && text.toLowerCase() === 'exit') {
                addBotMessage("Cancelled. Returning to main menu.");
                startFlow();
                return;
            }
            if (currentState === 'IDLE') {
                if (actionId === 'search_menu') {
                    currentState = 'ASK_SEARCH_TYPE';
                    addBotMessage("What do you want to search for?");
                    renderOptions([
                        { label: "💻 PcComponentes", actionId: "search_pccomp" },
                        { label: "🏠 atHome.lu apartments", actionId: "search_athome" },
                        { label: "← Back", actionId: "back" }
                    ]);
                } else if (actionId === 'alert_menu') {
                    currentState = 'ASK_ALERT_ACTION';
                    addBotMessage("Telegram alerts will notify you when matching apartments are found during automatic scraping.");
                    renderOptions([
                        { label: "➕ Create alert", actionId: "create_alert" },
                        { label: "📋 Manage alerts", actionId: "manage_alerts" },
                        { label: "← Back", actionId: "back" }
                    ]);
                } else if (actionId === 'action_menu') {
                    currentState = 'ASK_ACTION';
                    addBotMessage("What action would you like to perform?");
                    renderOptions([
                        { label: "📍 Set reference address", actionId: "set_distance" },
                        { label: "▶️ Run PcComponentes routine", actionId: "scrape_routine" },
                        { label: "▶️ Run atHome.lu routine", actionId: "scrape_athome" },
                        { label: "🎛️ Set filters", actionId: "set_filters" },
                        { label: "💾 Save filters as preset", actionId: "save_preset" },
                        { label: "📊 View statistics", actionId: "view_stats" },
                        { label: "🗑️ Clear filters", actionId: "clear_filters" },
                        { label: "← Back", actionId: "back" }
                    ]);
                } else if (actionId === 'confirm_rule') {
                    await createBotRule();
                } else if (actionId === 'restart_rule') {
                    currentState = 'ASK_BOT_RULE_NAME';
                    context = {};
                    addBotMessage("Let's start over. What name do you want to give this rule?");
                    updateInputVisibility();
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_SEARCH_TYPE') {
                if (actionId === 'search_pccomp') {
                    currentState = 'ASK_SEARCH_QUERY';
                    context.searchType = 'pccomponentes';
                    addBotMessage("What product do you want to search on PcComponentes? E.g.: RTX 4060, Ryzen 5 7600");
                    updateInputVisibility();
                } else if (actionId === 'search_athome') {
                    currentState = 'ASK_SEARCH_QUERY';
                    context.searchType = 'athome';
                    addBotMessage("What area in Luxembourg do you want to search for apartments? E.g.: Luxembourg, Esch-sur-Alzette");
                    updateInputVisibility();
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_ALERT_ACTION') {
                if (actionId === 'create_alert') {
                    await showPresetOptionsForAlert();
                } else if (actionId === 'manage_alerts') {
                    await listBotRules();
                } else if (actionId === 'delete_alert') {
                    await showDeleteRules();
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_BOT_LOAD_PRESET') {
                if (actionId === 'no_preset') {
                    currentState = 'ASK_BOT_RULE_NAME';
                    addBotMessage("Let's set up a Telegram alert for apartments!\n\nThe bot will scrape atHome.lu every 2 hours and notify you when it finds a match.\n\nFirst, what name do you want to give this rule? E.g.: \"Luxembourg apartment\"");
                    updateInputVisibility();
                } else if (actionId && actionId.startsWith('preset_')) {
                    const presetName = actionId.replace('preset_', '');
                    await loadPresetForAlert(presetName);
                    const details = context.presetDetails || `Loaded preset "${presetName}".`;
                    let editOpts = [];
                    if (context.maxPrice !== undefined) editOpts.push({ label: "✏️ Edit max price", actionId: "edit_maxprice" });
                    if (context.maxDistance !== undefined) editOpts.push({ label: "✏️ Edit max distance", actionId: "edit_maxdist" });
                    editOpts.push({ label: "✏️ Edit keywords", actionId: "edit_keywords" });
                    editOpts.push({ label: "✅ No, continue", actionId: "preset_ok" });
                    currentState = 'ASK_BOT_REVIEW_PRESET';
                    addBotMessage(`${details}\n\nDo you want to change any of these values?`);
                    renderOptions(editOpts);
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_BOT_REVIEW_PRESET') {
                if (actionId === 'edit_maxprice') {
                    currentState = 'ASK_BOT_MAX_PRICE';
                    context.fromReview = true;
                    addBotMessage(`Current max price: **${context.maxPrice}€**. Enter a new value or 0 for no limit.`);
                    updateInputVisibility();
                } else if (actionId === 'edit_maxdist') {
                    currentState = 'ASK_BOT_MAX_DISTANCE';
                    context.fromReview = true;
                    addBotMessage(`Current max distance: **${context.maxDistance} km**. Enter a new value or 0 for no limit.`);
                    updateInputVisibility();
                } else if (actionId === 'edit_keywords') {
                    currentState = 'ASK_BOT_KEYWORDS';
                    context.fromReview = true;
                    addBotMessage(`Current keywords: **${context.keywords}**. Enter new keywords (comma-separated) or leave empty to clear.`);
                    updateInputVisibility();
                } else if (actionId === 'preset_ok') {
                    if (context.minSurface === undefined) context.minSurface = 0;
                    if (!context.keywords) context.keywords = '';
                    currentState = 'ASK_BOT_RULE_NAME';
                    addBotMessage("Now, what name do you want to give this rule? E.g.: \"Luxembourg apartment\"");
                    updateInputVisibility();
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_DELETE_RULE') {
                if (actionId && actionId.startsWith('del_')) {
                    const idx = parseInt(actionId.replace('del_', ''));
                    const rules = context.deleteRules || [];
                    const rule = rules[idx];
                    if (!rule) {
                        addBotMessage("Invalid selection.");
                        setTimeout(() => startFlow(false), 1000);
                        return;
                    }
                    addBotMessage(`Are you sure you want to delete "${rule.name}"?`);
                    currentState = 'CONFIRM_DELETE_RULE';
                    context.pendingDeleteRule = rule;
                    renderOptions([
                        { label: "✅ Yes, delete it", actionId: "confirm_delete" },
                        { label: "↩️ No, go back", actionId: "back" }
                    ]);
                } else {
                    startFlow();
                }
            } else if (currentState === 'CONFIRM_DELETE_RULE') {
                if (actionId === 'confirm_delete') {
                    const rule = context.pendingDeleteRule;
                    if (!rule) { startFlow(); return; }
                    addBotMessage(`Deleting "${rule.name}"...`);
                    const data = await fetchAPI(`/api/scraper/bot_rules/${rule.id}`, { method: 'DELETE' });
                    if (data && data.status === 'ok') {
                        addBotMessage(`Alert "${rule.name}" deleted successfully. 🗑️`);
                        if (typeof loadBotRules === 'function') loadBotRules();
                    } else {
                        addBotMessage("Error deleting rule: " + (data?.error || data?.message || 'Unknown error'));
                    }
                    context.pendingDeleteRule = null;
                    setTimeout(() => startFlow(false), 2000);
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_ACTION') {
                if (actionId === 'set_distance') {
                    currentState = 'ASK_REF_ADDRESS';
                    addBotMessage("Enter your reference address to calculate distances. E.g.: 4 Rue Peternelchen, Luxembourg");
                    updateInputVisibility();
                } else if (actionId === 'scrape_routine') {
                    await triggerScrapeRoutine();
                } else if (actionId === 'scrape_athome') {
                    await triggerAthomeRoutine();
                } else if (actionId === 'save_preset') {
                    await saveFilterPresetFlow();
                } else if (actionId === 'view_stats') {
                    await showStats();
                } else if (actionId === 'set_filters') {
                    currentState = 'ASK_FILTER_ADDRESS';
                    context.filterSettings = {};
                    addBotMessage("Let's set up filters!\n\nFirst, what's your **reference address** for distance calculations? (e.g.: 4 Rue Peternelchen, Luxembourg)\n\nLeave empty and press Enter to skip.");
                    updateInputVisibility();
                } else if (actionId === 'clear_filters') {
                    clearFilters();
                } else {
                    startFlow();
                }
            } else if (currentState === 'ASK_SEARCH_QUERY') {
                const query = text.trim();
                if (!query) {
                    addBotMessage("Please enter something to search for.");
                    updateInputVisibility();
                    return;
                }
                currentState = 'IDLE';
                if (context.searchType === 'pccomponentes') {
                    addBotMessage(`Searching for "${query}" on PcComponentes...`);
                    const data = await fetchAPI('/api/scraper/pccomponentes/search', {
                        method: 'POST',
                        body: JSON.stringify({ query })
                    });
                    if (data && data.status === 'ok') {
                        addBotMessage("Search queued. Results will appear in the table when ready.");
                    } else {
                        addBotMessage("Error: " + (data?.error || 'Could not start search'));
                    }
                } else {
                    addBotMessage(`Searching for apartments in "${query}"...`);
                    const data = await fetchAPI('/api/scraper/athome/search', {
                        method: 'POST',
                        body: JSON.stringify({ query })
                    });
                    if (data && data.status === 'ok') {
                        addBotMessage("Search queued. Results will appear in the table when ready.");
                    } else {
                        addBotMessage("Error: " + (data?.error || 'Could not start search'));
                    }
                }
                setTimeout(() => startFlow(false), 1500);
            } else if (currentState === 'ASK_REF_ADDRESS') {
                const address = text.trim();
                if (!address) {
                    addBotMessage("Please enter a valid address.");
                    updateInputVisibility();
                    return;
                }
                currentState = 'IDLE';
                addBotMessage("Saving reference address and calculating distances...");
                const data = await fetchAPI('/api/scraper/config/reference', {
                    method: 'POST',
                    body: JSON.stringify({ address })
                });
                if (data && data.status === 'ok') {
                    addBotMessage("Address saved. Distances are being calculated in the background and will appear automatically.");
                    localStorage.setItem('nv_scraper_ref', address);
                } else {
                    addBotMessage("Error: " + (data?.error || 'Could not save address'));
                }
                setTimeout(() => startFlow(false), 2000);
            } else if (currentState === 'ASK_BOT_RULE_NAME') {
                const name = text.trim();
                if (!name || name.length < 2) {
                    addBotMessage("Please enter a valid name (at least 2 characters).");
                    updateInputVisibility();
                    return;
                }
                context.ruleName = name;
                if (context.maxPrice !== undefined && context.minSurface !== undefined && context.maxDistance !== undefined) {
                    currentState = 'ASK_BOT_PARKING';
                    addBotMessage(`Rule name set to "${name}". All basic filters pre-filled from preset.\n\nNow for the **advanced filters**.\n\n**Parking:** What do you prefer?`);
                    renderOptions([
                        { label: "🚗 Any", actionId: "park_any" },
                        { label: "🅿️ Required", actionId: "park_yes" },
                        { label: "🚫 Exclude", actionId: "park_no" }
                    ]);
                } else if (context.maxPrice !== undefined) {
                    currentState = 'ASK_BOT_MIN_SURFACE';
                    addBotMessage(`Rule name set to "${name}". Max price already set to **${context.maxPrice}€** from preset.\n\nWhat's the **minimum surface area** (m²) required? Enter 0 for no limit.`);
                    updateInputVisibility();
                } else {
                    currentState = 'ASK_BOT_MAX_PRICE';
                    addBotMessage(`Rule name set to "${name}".\n\nWhat's the **maximum monthly rent** (€) you're willing to pay? Enter 0 for no limit.`);
                    updateInputVisibility();
                }
            } else if (currentState === 'ASK_BOT_MAX_PRICE') {
                const priceStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const price = parseFloat(priceStr);
                if (isNaN(price) || price < 0) {
                    addBotMessage("Please enter a valid number (e.g.: 1500). Enter 0 for no limit.");
                    updateInputVisibility();
                    return;
                }
                context.maxPrice = price;
                if (context.fromReview) {
                    context.fromReview = false;
                    currentState = 'ASK_BOT_REVIEW_PRESET';
                    const details = context.presetDetails || '';
                    let editOpts = [];
                    if (context.maxPrice !== undefined) editOpts.push({ label: "✏️ Edit max price", actionId: "edit_maxprice" });
                    if (context.maxDistance !== undefined) editOpts.push({ label: "✏️ Edit max distance", actionId: "edit_maxdist" });
                    editOpts.push({ label: "✏️ Edit keywords", actionId: "edit_keywords" });
                    editOpts.push({ label: "✅ No, continue", actionId: "preset_ok" });
                    addBotMessage(`Max price updated to **${context.maxPrice}€**.\n\n${details}\n\nAnything else to change?`);
                    renderOptions(editOpts);
                } else {
                    currentState = 'ASK_BOT_MIN_SURFACE';
                    addBotMessage("What's the **minimum surface area** (m²) required? Enter 0 for no limit.");
                    updateInputVisibility();
                }
            } else if (currentState === 'ASK_BOT_MIN_SURFACE') {
                const surfStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const surface = parseFloat(surfStr);
                if (isNaN(surface) || surface < 0) {
                    addBotMessage("Please enter a valid number (e.g.: 45). Enter 0 for no limit.");
                    updateInputVisibility();
                    return;
                }
                context.minSurface = surface;
                if (context.maxDistance !== undefined) {
                    if (context.keywords) {
                        currentState = 'ASK_BOT_PARKING';
                        addBotMessage("**Parking:** What do you prefer?");
                        renderOptions([
                            { label: "🚗 Any", actionId: "park_any" },
                            { label: "🅿️ Required", actionId: "park_yes" },
                            { label: "🚫 Exclude", actionId: "park_no" }
                        ]);
                    } else {
                        currentState = 'ASK_BOT_KEYWORDS';
                        addBotMessage("Any **keywords** to look for in the listing description? (comma-separated)\n\nE.g.: garage, parking, elevator, balcony, pool\n\nLeave empty and press Enter to skip.");
                        updateInputVisibility();
                    }
                } else {
                    currentState = 'ASK_BOT_MAX_DISTANCE';
                    addBotMessage("What's the **maximum distance** (km) from your reference address? Enter 0 for no limit.");
                    updateInputVisibility();
                }
            } else if (currentState === 'ASK_BOT_KEYWORDS') {
                const kws = text.trim();
                context.keywords = kws;
                if (context.fromReview) {
                    context.fromReview = false;
                    currentState = 'ASK_BOT_REVIEW_PRESET';
                    const details = context.presetDetails || '';
                    let editOpts = [];
                    if (context.maxPrice !== undefined) editOpts.push({ label: "✏️ Edit max price", actionId: "edit_maxprice" });
                    if (context.maxDistance !== undefined) editOpts.push({ label: "✏️ Edit max distance", actionId: "edit_maxdist" });
                    editOpts.push({ label: "✏️ Edit keywords", actionId: "edit_keywords" });
                    editOpts.push({ label: "✅ No, continue", actionId: "preset_ok" });
                    addBotMessage(`Keywords updated to **${context.keywords || '(none)'}**.\n\n${details}\n\nAnything else to change?`);
                    renderOptions(editOpts);
                } else {
                    currentState = 'ASK_BOT_PARKING';
                    addBotMessage("**Parking:** What do you prefer?");
                    renderOptions([
                        { label: "🚗 Any", actionId: "park_any" },
                        { label: "🅿️ Required", actionId: "park_yes" },
                        { label: "🚫 Exclude", actionId: "park_no" }
                    ]);
                }
            } else if (currentState === 'ASK_BOT_MAX_DISTANCE') {
                const distStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const dist = parseFloat(distStr);
                if (isNaN(dist) || dist < 0) {
                    addBotMessage("Please enter a valid number (e.g. 11). Enter 0 for no limit.");
                    updateInputVisibility();
                    return;
                }
                context.maxDistance = dist;
                if (context.fromReview) {
                    context.fromReview = false;
                    currentState = 'ASK_BOT_REVIEW_PRESET';
                    const details = context.presetDetails || '';
                    let editOpts = [];
                    if (context.maxPrice !== undefined) editOpts.push({ label: "✏️ Edit max price", actionId: "edit_maxprice" });
                    if (context.maxDistance !== undefined) editOpts.push({ label: "✏️ Edit max distance", actionId: "edit_maxdist" });
                    editOpts.push({ label: "✏️ Edit keywords", actionId: "edit_keywords" });
                    editOpts.push({ label: "✅ No, continue", actionId: "preset_ok" });
                    addBotMessage(`Max distance updated to **${context.maxDistance} km**.\n\n${details}\n\nAnything else to change?`);
                    renderOptions(editOpts);
                } else if (context.keywords) {
                    currentState = 'ASK_BOT_PARKING';
                    addBotMessage("**Parking:** What do you prefer?");
                    renderOptions([
                        { label: "🚗 Any", actionId: "park_any" },
                        { label: "🅿️ Required", actionId: "park_yes" },
                        { label: "🚫 Exclude", actionId: "park_no" }
                    ]);
                } else {
                    currentState = 'ASK_BOT_KEYWORDS';
                    addBotMessage("Any **keywords** to look for in the listing description? (comma-separated)\n\nE.g.: garage, parking, elevator, balcony, pool\n\nLeave empty and press Enter to skip.");
                    updateInputVisibility();
                }
            } else if (currentState === 'ASK_BOT_PARKING') {
                if (actionId === 'park_any') context.botParking = '';
                else if (actionId === 'park_yes') context.botParking = 'has_parking';
                else if (actionId === 'park_no') context.botParking = 'no_parking';
                else { startFlow(); return; }
                currentState = 'ASK_BOT_PETS';
                addBotMessage("**Pets:** What do you prefer?");
                renderOptions([
                    { label: "🐾 Any", actionId: "pets_any" },
                    { label: "🐕 Allowed", actionId: "pets_yes" },
                    { label: "🚫 Exclude", actionId: "pets_no" }
                ]);
            } else if (currentState === 'ASK_BOT_PETS') {
                if (actionId === 'pets_any') context.botPets = '';
                else if (actionId === 'pets_yes') context.botPets = 'pets_allowed';
                else if (actionId === 'pets_no') context.botPets = 'no_pets';
                else { startFlow(); return; }
                currentState = 'ASK_BOT_AVAIL_DATE';
                addBotMessage("**Availability date:** Enter a date (YYYY-MM-DD) to require availability before that date, or type **skip** to ignore.\n\nE.g.: 2026-08-01");
                updateInputVisibility();
            } else if (currentState === 'ASK_BOT_AVAIL_DATE') {
                const val = text.trim();
                if (val.toLowerCase() !== 'skip' && val !== '') {
                    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                    if (!dateRegex.test(val)) {
                        addBotMessage("Invalid date format. Please use YYYY-MM-DD (e.g. 2026-08-01) or type **skip** to ignore.");
                        updateInputVisibility();
                        return;
                    }
                    context.botAvailDate = val;
                } else {
                    context.botAvailDate = '';
                }
                showRuleSummary();
            } else if (currentState === 'ASK_FILTER_NAME') {
                const name = text.trim();
                if (!name) {
                    addBotMessage("Please enter a name for the preset.");
                    updateInputVisibility();
                    return;
                }
                await doSaveFilterPreset(name);
                setTimeout(() => startFlow(false), 1000);
            } else if (currentState === 'ASK_FILTER_ADDRESS') {
                const addr = text.trim();
                context.filterSettings.address = addr;
                currentState = 'ASK_FILTER_MAX_DIST';
                addBotMessage("What's the **maximum distance** (km) from the reference address? Enter 0 for no limit.");
                updateInputVisibility();
            } else if (currentState === 'ASK_FILTER_MAX_DIST') {
                const distStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const dist = parseFloat(distStr);
                if (isNaN(dist) || dist < 0) {
                    addBotMessage("Please enter a valid number (e.g. 10). Enter 0 for no limit.");
                    updateInputVisibility();
                    return;
                }
                context.filterSettings.maxDist = dist;
                currentState = 'ASK_FILTER_STOCK';
                addBotMessage("**Availability status:** What do you want to see?");
                renderOptions([
                    { label: "📦 Any", actionId: "stock_any" },
                    { label: "✅ Available", actionId: "stock_in" },
                    { label: "❌ Sold/Rented", actionId: "stock_out" }
                ]);
            } else if (currentState === 'ASK_FILTER_STOCK') {
                if (actionId === 'stock_any') context.filterSettings.stock = '';
                else if (actionId === 'stock_in') context.filterSettings.stock = 'in_stock';
                else if (actionId === 'stock_out') context.filterSettings.stock = 'out_of_stock';
                else { startFlow(); return; }
                currentState = 'ASK_FILTER_CATEGORY';
                const catEl = document.getElementById('filter-category');
                let catOpts = [];
                if (catEl) {
                    for (const opt of catEl.options) {
                        if (opt.value) catOpts.push({ label: opt.textContent, actionId: 'cat_' + opt.value });
                    }
                }
                if (catOpts.length === 0) {
                    catOpts = [
                        { label: "🏠 Apartment", actionId: "cat_apartment" },
                        { label: "🛏️ Room", actionId: "cat_room" },
                        { label: "🏡 House", actionId: "cat_house" },
                        { label: "📐 Studio", actionId: "cat_studio" }
                    ];
                }
                catOpts.unshift({ label: "🌐 Any type", actionId: "cat_" });
                addBotMessage("**Property type:** What are you looking for?");
                renderOptions(catOpts);
            } else if (currentState === 'ASK_FILTER_CATEGORY') {
                if (actionId && actionId.startsWith('cat_')) {
                    context.filterSettings.category = actionId.replace('cat_', '');
                } else {
                    startFlow(); return;
                }
                currentState = 'ASK_FILTER_MIN_PRICE';
                addBotMessage("What's the **minimum price** (€)? Enter 0 for no minimum.");
                updateInputVisibility();
            } else if (currentState === 'ASK_FILTER_MIN_PRICE') {
                const minStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const min = parseFloat(minStr);
                if (isNaN(min) || min < 0) {
                    addBotMessage("Please enter a valid minimum price (e.g. 500). Enter 0 for no minimum.");
                    updateInputVisibility();
                    return;
                }
                context.filterSettings.minPrice = min;
                currentState = 'ASK_FILTER_MAX_PRICE';
                addBotMessage("What's the **maximum price** (€)? Enter 0 for no limit.");
                updateInputVisibility();
            } else if (currentState === 'ASK_FILTER_MAX_PRICE') {
                const maxStr = text.replace(/[^0-9.,]/g, '').replace(',', '.');
                const max = parseFloat(maxStr);
                if (isNaN(max) || max < 0) {
                    addBotMessage("Please enter a valid maximum price (e.g. 2000). Enter 0 for no limit.");
                    updateInputVisibility();
                    return;
                }
                context.filterSettings.maxPrice = max;
                currentState = 'ASK_FILTER_PARKING';
                addBotMessage("**Parking:** What do you prefer?");
                renderOptions([
                    { label: "🚗 Any", actionId: "parking_any" },
                    { label: "🅿️ With parking", actionId: "parking_yes" },
                    { label: "🚫 No parking", actionId: "parking_no" }
                ]);
            } else if (currentState === 'ASK_FILTER_PARKING') {
                if (actionId === 'parking_any') context.filterSettings.parking = '';
                else if (actionId === 'parking_yes') context.filterSettings.parking = 'has_parking';
                else if (actionId === 'parking_no') context.filterSettings.parking = 'no_parking';
                else { startFlow(); return; }
                currentState = 'ASK_FILTER_PETS';
                addBotMessage("**Pets:** What do you prefer?");
                renderOptions([
                    { label: "🐾 Any", actionId: "pets_any" },
                    { label: "🐕 Pets allowed", actionId: "pets_yes" },
                    { label: "🚫 No pets", actionId: "pets_no" }
                ]);
            } else if (currentState === 'ASK_FILTER_PETS') {
                if (actionId === 'pets_any') context.filterSettings.pets = '';
                else if (actionId === 'pets_yes') context.filterSettings.pets = 'pets_allowed';
                else if (actionId === 'pets_no') context.filterSettings.pets = 'no_pets';
                else { startFlow(); return; }
                currentState = 'ASK_FILTER_AVAIL_DATE';
                addBotMessage("**Availability date:** Enter a date (YYYY-MM-DD) to filter apartments available before that date, or type **skip** to ignore this filter.\n\nE.g.: 2026-08-01");
                updateInputVisibility();
            } else if (currentState === 'ASK_FILTER_AVAIL_DATE') {
                const val = text.trim();
                if (val.toLowerCase() !== 'skip' && val !== '') {
                    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                    if (!dateRegex.test(val)) {
                        addBotMessage("Invalid date format. Please use YYYY-MM-DD (e.g. 2026-08-01) or type **skip** to ignore.");
                        updateInputVisibility();
                        return;
                    }
                    context.filterSettings.availDate = val;
                } else {
                    context.filterSettings.availDate = '';
                }
                await applyFilterSettings();
            }
            updateInputVisibility();
        }, 400);
    }

    function showRuleSummary() {
        currentState = 'IDLE';
        const name = context.ruleName;
        const price = context.maxPrice > 0 ? context.maxPrice + '€' : 'No limit';
        const surface = context.minSurface > 0 ? context.minSurface + 'm²' : 'No limit';
        const dist = context.maxDistance > 0 ? context.maxDistance + ' km' : 'No limit';
        const kws = context.keywords || 'None';
        const parkMap = { 'has_parking': 'Required', 'no_parking': 'Exclude', '': 'Any' };
        const petsMap = { 'pets_allowed': 'Allowed', 'no_pets': 'Exclude', '': 'Any' };
        const park = parkMap[context.botParking] || 'Any';
        const pets = petsMap[context.botPets] || 'Any';
        const date = context.botAvailDate || 'Not set';
        addBotMessage(`**Rule Summary:**\n\n📋 **Name:** ${name}\n💰 **Max Price:** ${price}\n📐 **Min Surface:** ${surface}\n📏 **Max Distance:** ${dist}\n🔑 **Keywords:** ${kws}\n🅿️ **Parking:** ${park}\n🐾 **Pets:** ${pets}\n📅 **Avail. before:** ${date}\n\nDoes everything look correct?`);
        renderOptions([
            { label: "✅ Create Alert", actionId: "confirm_rule" },
            { label: "✏️ Start Over", actionId: "restart_rule" },
            { label: "← Back", actionId: "back" }
        ]);
    }

    async function createBotRule() {
        const payload = {
            name: context.ruleName,
            max_price: context.maxPrice || 0,
            min_surface: context.minSurface || 0,
            max_distance: context.maxDistance || 0,
            keywords: context.keywords || '',
            parking: context.botParking || '',
            pets: context.botPets || '',
            availability_date: context.botAvailDate || ''
        };
        addBotMessage("Creating your alert rule...");
        const data = await fetchAPI('/api/scraper/bot_rules', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (data && data.status === 'ok') {
            addBotMessage("**Alert created successfully!** 🎉\n\nThe Telegram bot will now scrape atHome.lu every 2 hours and send you a notification when it finds an apartment matching your criteria.\n\nMake sure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set in your .env file.");
            if (typeof loadBotRules === 'function') loadBotRules();
        } else {
            addBotMessage("Error creating rule: " + (data?.error || data?.message || 'Unknown error'));
        }
        setTimeout(() => startFlow(false), 2000);
    }

    async function listBotRules() {
        addBotMessage("Loading your alert rules...");
        const data = await fetchAPI('/api/scraper/bot_rules');
        if (!data) { setTimeout(() => startFlow(false), 1000); return; }
        const rules = data.rules || [];
        if (rules.length === 0) {
            addBotMessage("You have **no alert rules** configured yet. Create one to get Telegram notifications when matching apartments are found.");
            renderOptions([
                { label: "➕ Create an Alert", actionId: "create_alert" },
                { label: "← Back", actionId: "back" }
            ]);
            return;
        }
        let msg = "**Your Alert Rules:**\n";
        rules.forEach((r, i) => {
            const status = r.is_active ? '🟢 Active' : '🔴 Inactive';
            const price = r.max_price ? r.max_price + '€' : 'No limit';
            const surf = r.min_surface ? r.min_surface + 'm²' : 'No limit';
            msg += `\n${i+1}. **${r.name}** ${status}\n   Max: ${price} | Min: ${surf} | Keywords: ${r.keywords || 'N/A'}`;
        });
        addBotMessage(msg);
        renderOptions([
            { label: "➕ Create New Alert", actionId: "create_alert" },
            { label: "🗑️ Delete an Alert", actionId: "delete_alert" },
            { label: "← Back", actionId: "back" }
        ]);
    }

    async function showPresetOptionsForAlert() {
        currentState = 'ASK_BOT_LOAD_PRESET';
        context = {};
        const presets = window.scraperPresets || {};
        const names = Object.keys(presets).filter(n => n !== 'Predeterminado');
        if (names.length === 0) {
            currentState = 'ASK_BOT_RULE_NAME';
            addBotMessage("Let's set up a Telegram alert for apartments!\n\nThe bot will scrape atHome.lu every 2 hours and notify you when it finds a match.\n\nFirst, what name do you want to give this rule? E.g.: \"Luxembourg apartment\"");
            updateInputVisibility();
            return;
        }
        let msg = "Do you want to start from a saved filter preset? This will pre-fill the price and keywords for your alert.";
        addBotMessage(msg);
        const opts = names.map(n => ({ label: n, actionId: 'preset_' + n }));
        opts.push({ label: "✏️ No, start fresh", actionId: "no_preset" });
        opts.push({ label: "← Back", actionId: "back" });
        renderOptions(opts);
    }

    function mapFilterValue(key, val) {
        if (!val) return 'Not set';
        const map = {
            'filter-stock': { 'in_stock': 'Available', 'out_of_stock': 'Sold/Rented' },
            'filter-rating': { '0': 'Any', '3': '30 m²', '4': '40 m²', '4.5': '45 m²' },
            'filter-fluctuation': { 'any': 'Any fluctuation', 'drop_any': 'Price drop', 'rise_any': 'Price rise' }
        };
        const m = map[key];
        if (m && m[val]) return m[val];
        if (key === 'filter-category') {
            const el = document.getElementById('filter-category');
            if (el) {
                for (const opt of el.options) {
                    if (opt.value === val) return opt.textContent;
                }
            }
        }
        if (key === 'filter-price-min' || key === 'filter-price-max' || key === 'filter-distance-max') {
            const n = parseFloat(val);
            if (!isNaN(n)) return n + (key === 'filter-distance-max' ? ' km' : '€');
        }
        return val;
    }

    async function loadPresetForAlert(presetName) {
        const presets = window.scraperPresets || {};
        const p = presets[presetName];
        if (!p) return false;
        const maxPriceVal = p['filter-price-max'];
        if (maxPriceVal) {
            const parsed = parseFloat(maxPriceVal);
            if (!isNaN(parsed) && parsed > 0) context.maxPrice = parsed;
        }
        const maxDistVal = p['filter-distance-max'];
        if (maxDistVal) {
            const parsed = parseFloat(maxDistVal);
            if (!isNaN(parsed) && parsed > 0) context.maxDistance = parsed;
        }
        const ratingVal = p['filter-rating'];
        const ratingMap = { '3': 30, '4': 40, '4.5': 45 };
        if (ratingVal && ratingMap[ratingVal]) {
            context.minSurface = ratingMap[ratingVal];
        }
        const keywordsVal = p['local-filter'];
        if (keywordsVal) context.keywords = keywordsVal;
        context.fromPreset = presetName;
        const fields = [
            { key: 'filter-reference-address', label: '📍 Reference address' },
            { key: 'filter-distance-max', label: '📏 Max distance' },
            { key: 'filter-stock', label: '📦 Status' },
            { key: 'filter-category', label: '🏠 Type' },
            { key: 'filter-rating', label: '📐 Min surface' },
            { key: 'filter-price-min', label: '💰 Min price' },
            { key: 'filter-price-max', label: '💰 Max price' },
            { key: 'local-filter', label: '🔑 Keywords' }
        ];
        let details = `**Preset: ${presetName}**\n`;
        fields.forEach(f => {
            const val = p[f.key];
            details += `\n${f.label}: ${mapFilterValue(f.key, val)}`;
        });
        context.presetDetails = details;
        return true;
    }

    async function showDeleteRules() {
        addBotMessage("Loading rules...");
        const data = await fetchAPI('/api/scraper/bot_rules');
        if (!data || !data.rules || data.rules.length === 0) {
            addBotMessage("No rules to delete.");
            renderOptions([{ label: "← Back", actionId: "back" }]);
            return;
        }
        const rules = data.rules;
        context.deleteRules = rules;
        currentState = 'ASK_DELETE_RULE';
        let msg = "**Select a rule to delete:**\n";
        rules.forEach((r, i) => {
            msg += `\n${i+1}. ${r.name}${r.is_active ? ' 🟢' : ' 🔴'}`;
        });
        addBotMessage(msg);
        const opts = rules.map((r, i) => ({ label: `${i+1}. ${r.name}`, actionId: `del_${i}` }));
        opts.push({ label: "← Back", actionId: "back" });
        renderOptions(opts);
    }

    async function saveFilterPresetFlow() {
        addBotMessage("Saving current filters as a preset will store all your active filter settings.\n\nWhat name do you want for this preset?");
        currentState = 'ASK_FILTER_NAME';
        updateInputVisibility();
    }

    async function doSaveFilterPreset(name) {
        addBotMessage(`Saving preset "${name}"...`);
        try {
            const cfgRes = await fetchAPI('/api/scraper/config');
            if (!cfgRes) return;
            const target = localStorage.getItem('nv_scraper_target') || 'athome';
            let filters = {};
            try { filters = JSON.parse(cfgRes.filters || '{}'); } catch (e) { filters = {}; }
            if (!filters[target]) filters[target] = {};
            const preset = {};
            const fields = ['local-filter', 'filter-reference-address', 'filter-distance-max', 'filter-stock', 'filter-category', 'filter-rating', 'filter-price-min', 'filter-price-max', 'filter-fluctuation', 'filter-pets', 'filter-parking', 'filter-availability-date'];
            fields.forEach(id => {
                const el = document.getElementById(id);
                if (el) preset[id] = el.value;
            });
            filters[target][name] = preset;
            const saveRes = await fetchAPI('/api/scraper/config', {
                method: 'POST',
                body: JSON.stringify({ filters: JSON.stringify(filters) })
            });
            if (saveRes && saveRes.success) {
                addBotMessage(`Preset "${name}" saved! You can load it from the filter panel.`);
            } else {
                addBotMessage("Error saving preset.");
            }
        } catch (e) {
            addBotMessage("Error: " + e.message);
        }
        if (typeof loadPresetsDropdown === 'function') loadPresetsDropdown();
    }

    async function triggerScrapeRoutine() {
        addBotMessage("Starting PcComponentes scraping routine...");
        const data = await fetchAPI('/api/scraper/pccomponentes/routine', {
            method: 'POST',
            body: JSON.stringify({ terms: [] })
        });
        if (data && data.status === 'ok') {
            addBotMessage("Routine started. Products will be updated in the table.");
        } else {
            addBotMessage("Error: " + (data?.error || 'Could not start routine'));
        }
        setTimeout(() => startFlow(false), 1500);
    }

    async function triggerAthomeRoutine() {
        addBotMessage("Starting atHome.lu scraping routine...");
        const data = await fetchAPI('/api/scraper/athome/routine', { method: 'POST' });
        if (data && data.status === 'ok') {
            addBotMessage("Apartment routine started. Results will appear in the table.");
        } else {
            addBotMessage("Error: " + (data?.error || 'Could not start routine'));
        }
        setTimeout(() => startFlow(false), 1500);
    }

    async function showStats() {
        addBotMessage("Loading statistics...");
        const data = await fetchAPI('/api/scraper/data?type=athome');
        if (data && Array.isArray(data)) {
            const total = data.length;
            const available = data.filter(p => p.availability !== 'Agotado').length;
            const avgPrice = data.length > 0 ? (data.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / data.length) : 0;
            addBotMessage(`**atHome.lu Statistics:**\n\n- **Total listings:** ${total}\n- **Available:** ${available}\n- **Average price:** ${avgPrice.toFixed(0)}€`);
        } else {
            addBotMessage("Could not load statistics.");
        }
        setTimeout(() => startFlow(false), 1500);
    }

    function clearFilters() {
        const ids = ['local-filter', 'filter-stock', 'filter-price-min', 'filter-price-max', 'filter-fluctuation', 'filter-category', 'filter-distance-max', 'filter-pets', 'filter-parking', 'filter-availability-date'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const fr = document.getElementById('filter-rating'); if (fr) fr.value = '0';
        if (typeof filterTable === 'function') filterTable();
        addBotMessage("Filters cleared. Showing all results.");
        setTimeout(() => startFlow(false), 1000);
    }

    async function applyFilterSettings() {
        const s = context.filterSettings;
        const addrEl = document.getElementById('filter-reference-address');
        const distEl = document.getElementById('filter-distance-max');
        const stockEl = document.getElementById('filter-stock');
        const catEl = document.getElementById('filter-category');
        const minEl = document.getElementById('filter-price-min');
        const maxEl = document.getElementById('filter-price-max');
        const parkEl = document.getElementById('filter-parking');
        const petsEl = document.getElementById('filter-pets');
        const dateEl = document.getElementById('filter-availability-date');
        if (addrEl) addrEl.value = s.address || '';
        if (distEl) distEl.value = s.maxDist > 0 ? s.maxDist : '';
        if (stockEl) stockEl.value = s.stock || '';
        if (catEl) catEl.value = s.category || '';
        if (minEl) minEl.value = s.minPrice > 0 ? s.minPrice : '';
        if (maxEl) maxEl.value = s.maxPrice > 0 ? s.maxPrice : '';
        if (parkEl) parkEl.value = s.parking || '';
        if (petsEl) petsEl.value = s.pets || '';
        if (dateEl) dateEl.value = s.availDate || '';
        addBotMessage("Filters applied to the table.");
        if (typeof filterTable === 'function') filterTable();
        setTimeout(() => startFlow(false), 1500);
    }

    function startFlow(showMessage = true) {
        currentState = 'IDLE';
        if (showMessage) {
            if (chatHistory) chatHistory.innerHTML = '';
            addBotMessage("Hi! I'm your scraping assistant. What would you like to do?");
        }
        renderOptions([
            { label: "🔍 Search", actionId: "search_menu" },
            { label: "🤖 Telegram alerts", actionId: "alert_menu" },
            { label: "⚡ Actions", actionId: "action_menu" }
        ]);
        updateInputVisibility();
    }

    document.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
            if (chatHistory && chatHistory.children.length === 0) startFlow();
        }, 500);
    });

    window.addEventListener('message', (e) => {
        if (e.data && e.data.actionId) {
            handleUserInput(e.data.label || e.data.actionId, e.data.actionId);
        }
    });
})();
