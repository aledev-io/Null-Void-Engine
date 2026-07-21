import * as Notes from './notes.js';
import * as API from './api.js';
import * as Files from './files.js';
import * as UI from './ui.js';
import * as Chat from './chat.js';
import * as Workspace from './workspace.js';
import { initSockets } from './socket_manager.js';


// Initialize when the DOM is ready and the global variables are set
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize modules
    if (window.currentUserId) {
        Notes.initNotes(window.currentUserId);
    } else {
        // Fallback or wait if defined elsewhere
        setTimeout(() => {
            if (window.currentUserId) {
                Notes.initNotes(window.currentUserId);
            }
        }, 500);
    }
    
    // 2. Expose Notes module functions to window to support inline onclicks
    // (This is a temporary measure during Phase 1 modularization)
    Object.defineProperty(window, 'notes', {
        get: () => Notes.notes
    });
    Object.defineProperty(window, 'currentNoteId', {
        get: () => Notes.currentNoteId
    });
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
    window.filterNotes = Notes.filterNotes;
    window.openNoteMenu = Notes.openNoteMenu;
    window.getNoteById = Notes.getNoteById;
    window.toggleShareNote = Notes.toggleShareNote;
    window.downloadCurrentNote = Notes.downloadCurrentNote;
    window.shareCurrentNote = Notes.shareCurrentNote;
    window.pinCurrentNote = Notes.pinCurrentNote;
    window.deleteCurrentNote = Notes.deleteCurrentNote;
    window.fetchModels = API.fetchModels;
    window.loadCloudItemsForAttach = API.loadCloudItemsForAttach;
    window.loadNotesItemsForAttach = API.loadNotesItemsForAttach;
    window.loadKnowledgeItemsForAttach = API.loadKnowledgeItemsForAttach;
    window.searchHuggingFace = API.searchHuggingFace;
    window.openAttachSelectorModal = Files.openAttachSelectorModal;
    window.closeAttachSelectorModal = Files.closeAttachSelectorModal;
    window.navigateSelectModalCloudUp = Files.navigateSelectModalCloudUp;
    window.renderAttachSelectorItems = Files.renderAttachSelectorItems;
    window.filterAttachSelectorItems = Files.filterAttachSelectorItems;
    window.selectCloudFileForAttach = Files.selectCloudFileForAttach;
    window.selectNoteForAttach = Files.selectNoteForAttach;
    window.selectKnowledgeForAttach = Files.selectKnowledgeForAttach;
    
    // Workspace exports
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
    window.deleteSelectedModel = UI.deleteSelectedModel;
    window.handleLogout = UI.handleLogout;
    window.isCode = UI.isCode;
    window.closeEditor = UI.closeEditor;
    window.updateEditorMeta = UI.updateEditorMeta;
    window.insertFormat = UI.insertFormat;
    window.toggleFilterDropdown = UI.toggleFilterDropdown;
    window.setOwnerFilter = Notes.setOwnerFilter;
    window.setPermFilter = Notes.setPermFilter;
    window.setViewMode = Notes.setViewMode;
    window.toggleViewDropdown = UI.toggleViewDropdown;
    window.toggleMoreOpts = UI.toggleMoreOpts;
    window.closeMoreOpts = UI.closeMoreOpts;
    window.showChat = Chat.showChat;
    window.handleRouting = Chat.handleRouting;
    window.autoResize = Chat.autoResize;
    window.init = Chat.init;
    window.toggleFilterMenu = Workspace.toggleFilterMenu;
    window.selectWorkspaceFilter = Workspace.selectWorkspaceFilter;
    window.archiveWorkspace = Workspace.archiveWorkspace;
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
    window.fetchAPIKeys = API.fetchAPIKeys;
    window.saveAPIKey = API.saveAPIKey;
    window.openApiKeysDialog = UI.openApiKeysDialog;
    window.closeApiKeysDialog = UI.closeApiKeysDialog;
    window.saveApiKeysConfig = UI.saveApiKeysConfig;
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
    window.handleCursorUpdate = Notes.handleCursorUpdate;
    window.handleNoteUpdate = Notes.handleNoteUpdate;

    if (window.socket) {
        initSockets();
    }

    // Always fetch starred workspaces for the sidebar
    Workspace.loadStarredWorkspacesSidebar();

});
