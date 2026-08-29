import * as Notes from './notes.js';
import * as API from './api.js';
import * as Files from './files.js';
import * as UI from './ui.js';
import * as Chat from './chat.js';
import * as Workspace from './workspace.js';
import { initSockets } from './socket_manager.js';

// Expose all handlers to global window immediately so HTML inline handlers never fail
Object.defineProperty(window, 'notes', { get: () => Notes.notes });
Object.defineProperty(window, 'currentNoteId', { get: () => Notes.currentNoteId });

// Notes
window.saveToNoteHistory = Notes.saveToNoteHistory;
window.undoNote = Notes.undoNote;
window.redoNote = Notes.redoNote;
window.commentNote = Notes.commentNote;
window.showNotes = Notes.showNotes;
window.saveNotes = Notes.saveNotes;
window.formatNoteDate = Notes.formatNoteDate;
window.renderNotesList = Notes.renderNotesList;
window.createNewNote = Notes.createNewNote;
window.openNoteEditor = Notes.openNoteEditor;
window.saveCurrentNote = Notes.saveCurrentNote;
window.manualSaveNote = Notes.manualSaveNote;
window.setNoteSaveStatus = Notes.setNoteSaveStatus;
window.filterNotes = Notes.filterNotes;
window.openNoteMenu = Notes.openNoteMenu;
window.getNoteById = Notes.getNoteById;
window.toggleShareNote = Notes.toggleShareNote;
window.downloadCurrentNote = Notes.downloadCurrentNote;
window.shareCurrentNote = Notes.shareCurrentNote;
window.pinCurrentNote = Notes.pinCurrentNote;
window.deleteCurrentNote = Notes.deleteCurrentNote;
window.setOwnerFilter = Notes.setOwnerFilter;
window.setPermFilter = Notes.setPermFilter;
window.setViewMode = Notes.setViewMode;
window.handleCursorUpdate = Notes.handleCursorUpdate;
window.handleNoteUpdate = Notes.handleNoteUpdate;

// API
window.fetchModels = API.fetchModels;
window.loadCloudItemsForAttach = API.loadCloudItemsForAttach;
window.loadNotesItemsForAttach = API.loadNotesItemsForAttach;
window.loadKnowledgeItemsForAttach = API.loadKnowledgeItemsForAttach;
window.searchHuggingFace = API.searchHuggingFace;
window.fetchAPIKeys = API.fetchAPIKeys;
window.saveAPIKey = API.saveAPIKey;
window.deleteAPIKey = API.deleteAPIKey;

// Files & Attachments
window.openAttachSelectorModal = Files.openAttachSelectorModal;
window.closeAttachSelectorModal = Files.closeAttachSelectorModal;
window.navigateSelectModalCloudUp = Files.navigateSelectModalCloudUp;
window.renderAttachSelectorItems = Files.renderAttachSelectorItems;
window.filterAttachSelectorItems = Files.filterAttachSelectorItems;
window.selectCloudFileForAttach = Files.selectCloudFileForAttach;
window.selectNoteForAttach = Files.selectNoteForAttach;
window.selectKnowledgeForAttach = Files.selectKnowledgeForAttach;
window.toggleAttachMenu = Files.toggleAttachMenu;
window.handleFileUpload = Files.handleFileUpload;
window.toggleMicRecording = Files.toggleMicRecording;
window.extractTextFromPdf = Files.extractTextFromPdf;
window.processFiles = Files.processFiles;
window.renameAttachment = Files.renameAttachment;
window.renderAttachedFiles = Files.renderAttachedFiles;
window.openFilePreview = Files.openFilePreview;
window.openAttachmentPreview = Files.openAttachmentPreview;
window.closeFilePreviewModal = Files.closeFilePreviewModal;
window.removeAttachment = Files.removeAttachment;
window.persistAttachment = Files.persistAttachment;
window.fireAndForgetPersist = Files.fireAndForgetPersist;
window.attachmentServerUrl = Files.attachmentServerUrl;
window.dataURLtoBlob = Files.dataURLtoBlob;
window.handleSmartPaste = Files.handleSmartPaste;
window.attachPastedText = Files.attachPastedText;
window.detectSnippetExtension = Files.detectSnippetExtension;
window.initPasteHandlers = Files.initPasteHandlers;

// Workspace
window.showWorkspaces = Workspace.showWorkspaces;
window.createNewWorkspace = Workspace.createNewWorkspace;
window.openWorkspaceDetail = Workspace.openWorkspaceDetail;
window.closeWorkspaceDetail = Workspace.closeWorkspaceDetail;
window.deleteCurrentWorkspace = Workspace.deleteCurrentWorkspace;
window.uploadWorkspaceFiles = Workspace.uploadWorkspaceFiles;
window.startWorkspaceChat = Workspace.startWorkspaceChat;
window.startWorkspaceChatFromInput = Workspace.startWorkspaceChatFromInput;
window.deleteWorkspaceFile = Workspace.deleteWorkspaceFile;
window.filterWorkspaces = Workspace.filterWorkspaces;
window.toggleFilterMenu = Workspace.toggleFilterMenu;
window.selectWorkspaceFilter = Workspace.selectWorkspaceFilter;

// UI & Modals
window.showInputDialog = UI.showInputDialog;
window.cancelInputDialog = UI.cancelInputDialog;
window.showConfirmDialog = UI.showConfirmDialog;
window.cancelConfirmDialog = UI.cancelConfirmDialog;
window.openPermissionsModal = UI.openPermissionsModal;
window.closePermissionsModal = UI.closePermissionsModal;
window.togglePermLevel = UI.togglePermLevel;
window.setPermLevel = UI.setPermLevel;
window.addPermission = UI.addPermission;
window.renderOllamaCatalog = UI.renderOllamaCatalog;
window.openCommandDialog = UI.openCommandDialog;
window.closeCommandDialog = UI.closeCommandDialog;
window.cancelCommandDialog = UI.cancelCommandDialog;
window.executeCommand = UI.executeCommand;
window.closeEditor = UI.closeEditor;
window.updateEditorMeta = UI.updateEditorMeta;
window.insertFormat = UI.insertFormat;
window.toggleFilterDropdown = UI.toggleFilterDropdown;
window.toggleViewDropdown = UI.toggleViewDropdown;
window.toggleMoreOpts = UI.toggleMoreOpts;
window.closeMoreOpts = UI.closeMoreOpts;
window.openApiKeysDialog = UI.openApiKeysDialog;
window.closeApiKeysDialog = UI.closeApiKeysDialog;
window.saveApiKeysConfig = UI.saveApiKeysConfig;
window.resetApiKeysForm = UI.resetApiKeysForm;
window.deleteApiKeyUI = UI.deleteApiKeyUI;
window.openModelSelectorModal = UI.openModelSelectorModal;
window.closeModelSelectorModal = UI.closeModelSelectorModal;
window.clearModelSelectorSearch = UI.clearModelSelectorSearch;
window.selectProvider = UI.selectProvider;
window.backToProviders = UI.backToProviders;
window.filterModelSelectorList = UI.filterModelSelectorList;
window.selectAndApplyModel = UI.selectAndApplyModel;
window.renderModelSelectorList = UI.renderModelSelectorList;
window.openModelSettingsDialog = UI.openModelSettingsDialog;
window.closeModelSettingsDialog = UI.closeModelSettingsDialog;
window.saveModelSettings = UI.saveModelSettings;
window.toggleApiKeyVisibility = UI.toggleApiKeyVisibility;
window.openShareDialog = UI.openShareDialog;
window.closeShareDialog = UI.closeShareDialog;
window.generateShareLink = UI.generateShareLink;
window.shareContentWithFriend = UI.shareContentWithFriend;
window.showToast = UI.showToast;
window.updateCursor = UI.updateCursor;
window.renderActiveCollaborators = UI.renderActiveCollaborators;

// Chat
window.showChat = Chat.showChat;
window.handleRouting = Chat.handleRouting;
window.autoResize = Chat.autoResize;
window.init = Chat.init;
window.setInput = Chat.setInput;
window.addCodeCopyButtons = Chat.addCodeCopyButtons;
window.createActionBar = Chat.createActionBar;
window.addMessage = Chat.addMessage;
window.sendMessage = Chat.sendMessage;
window.newChat = Chat.newChat;
window.saveHistory = Chat.saveHistory;
window.loadHistory = Chat.loadHistory;
window.renderChat = Chat.renderChat;
window.submitEditedMessage = Chat.submitEditedMessage;
window.toggleSidebar = Chat.toggleSidebar;
window.toggleUserMenu = Chat.toggleUserMenu;
window.toggleToolsMenu = Chat.toggleToolsMenu;
window.updateToolsMenuState = Chat.updateToolsMenuState;
window.toggleWebSearch = Chat.toggleWebSearch;
window.toggleAIMode = Chat.toggleAIMode;
window.toggleReasoningMode = Chat.toggleReasoningMode;
window.openChatContextMenu = Chat.openChatContextMenu;
window.closeContextMenu = Chat.closeContextMenu;
window.openMessageContextMenu = Chat.openMessageContextMenu;
window.renameChat = Chat.renameChat;
window.deleteChat = Chat.deleteChat;
window.deleteAllChats = Chat.deleteAllChats;
window.openSearch = Chat.openSearch;
window.closeSearch = Chat.closeSearch;
window.closeSearchOnBackdrop = Chat.closeSearchOnBackdrop;
window.onSearchInput = Chat.onSearchInput;
window.renderSearchHistory = Chat.renderSearchHistory;
window.checkActiveGenerations = Chat.checkActiveGenerations;
window.rebuildSearchItems = Chat.rebuildSearchItems;
window.getVisibleSearchItems = Chat.getVisibleSearchItems;
window.moveSearchSelection = Chat.moveSearchSelection;
window.activateSearchSelection = Chat.activateSearchSelection;

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Espejo del nombre del modelo actual hacia el label del top-nav (#top-model-label)
    const _modelSrc = document.getElementById('main-model-label');
    const _modelDst = document.getElementById('top-model-label');
    const _modelBtn = document.getElementById('top-model-btn');
    if (_modelDst) {
        const _fmtModel = (t) => {
            t = (t || '').trim();
            if (t.startsWith('API: openrouter:')) t = t.replace(/^API:\s*openrouter\s*:\s*/, '');
            else if (t.startsWith('API: google:')) t = t.replace(/^API:\s*google\s*:\s*/, '');
            else if (t.startsWith('API: openai:')) t = t.replace(/^API:\s*openai\s*:\s*/, '');
            else if (t.startsWith('API: deepseek:')) t = t.replace(/^API:\s*deepseek\s*:\s*/, '');
            else if (t.startsWith('API: ')) t = t.replace(/^API:\s*/, '');
            return t;
        };
        const _syncModelLabel = () => {
            const raw = (_modelSrc && _modelSrc.textContent) || _modelDst.textContent || '';
            const cleaned = _fmtModel(raw);
            _modelDst.textContent = cleaned || 'Elegir modelo';
            const fullTitle = 'Modelo actual: ' + (raw || 'Ninguno');
            _modelDst.title = fullTitle;
            if (_modelBtn) _modelBtn.title = fullTitle;
        };
        _syncModelLabel();
        if (_modelSrc) {
            new MutationObserver(_syncModelLabel).observe(_modelSrc, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }

    if (window.currentUserId) {
        Notes.initNotes(window.currentUserId);
    } else {
        setTimeout(() => {
            if (window.currentUserId) {
                Notes.initNotes(window.currentUserId);
            }
        }, 500);
    }

    initSockets();

    // Initialize smart paste handlers for chat inputs
    Files.initPasteHandlers();

    // Always fetch starred workspaces for the sidebar
    Workspace.loadStarredWorkspacesSidebar();
});
