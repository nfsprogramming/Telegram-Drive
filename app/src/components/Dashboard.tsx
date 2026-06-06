import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { toast } from 'sonner';

import { TelegramFile, BandwidthStats } from '../types';
import { isMediaFile, isPdfFile } from '../utils';
import { useConfirm } from '../context/ConfirmContext';

// Components
import { Sidebar } from './dashboard/Sidebar';
import { TopBar } from './dashboard/TopBar';
import { FileExplorer } from './dashboard/FileExplorer';
import { UploadQueue } from './dashboard/UploadQueue';
import { DownloadQueue } from './dashboard/DownloadQueue';
import { MoveToFolderModal } from './dashboard/MoveToFolderModal';
import { PreviewModal } from './dashboard/PreviewModal';
import { MediaPlayer } from './dashboard/MediaPlayer';
import { DragDropOverlay } from './dashboard/DragDropOverlay';
import { ExternalDropBlocker } from './dashboard/ExternalDropBlocker';
import { PdfViewer } from './dashboard/PdfViewer';

// Hooks
import { useTelegramConnection } from '../hooks/useTelegramConnection';
import { useFileOperations } from '../hooks/useFileOperations';
import { useFileUpload } from '../hooks/useFileUpload';
import { useFileDownload } from '../hooks/useFileDownload';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { useAutoLock } from '../hooks/useAutoLock';

export function Dashboard({ onLogout, onAddAccount }: { onLogout: () => void, onAddAccount: () => void }) {
    const queryClient = useQueryClient();

    const {
        store, accounts, activeAccountId, handleSwitchAccount, folders, activeFolderId, setActiveFolderId, isSyncing, isConnected, isSessionReady,
        unlockedVaults, handleUnlockVault, handleLockVault,
        handleLogout, handleSyncFolders, handleCreateFolder, handleFolderDelete
    } = useTelegramConnection(onLogout);

    useAutoLock(unlockedVaults, handleLockVault);

    const { confirm } = useConfirm();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const handleRemoveAccount = async (accountId: string) => {
        if (!await confirm({ title: "Remove Account", message: "Are you sure you want to remove this account? This will log you out if it is currently active.", confirmText: "Remove", variant: 'danger' })) return;

        try {
            if (accountId === activeAccountId) {
                // If removing the currently active account, log out
                await handleLogout();
            } else {
                // Otherwise, just remove it from store and refresh
                if (store) {
                    const updatedAccounts = accounts.filter(a => a.id !== accountId);
                    await store.set('accounts', updatedAccounts);
                    await store.delete(`${accountId}_folders`);
                    await store.delete(`${accountId}_activeFolderId`);
                    await store.save();
                    window.location.reload();
                }
            }
        } catch {
            toast.error("Error removing account");
        }
    };

    const [previewFile, setPreviewFile] = useState<TelegramFile | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<TelegramFile[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [internalDragFileId, _setInternalDragFileId] = useState<number | null>(null);
    const internalDragRef = useRef<number | null>(null);
    const [pendingDeepLinkFileId, setPendingDeepLinkFileId] = useState<number | null>(null);

    const setInternalDragFileId = (id: number | null) => {
        internalDragRef.current = id;
        _setInternalDragFileId(id);
    };
    const [playingFile, setPlayingFile] = useState<TelegramFile | null>(null);
    const [pdfFile, setPdfFile] = useState<TelegramFile | null>(null);
    const [previewContextFiles, setPreviewContextFiles] = useState<TelegramFile[]>([]);
    const [previewContextIndex, setPreviewContextIndex] = useState(-1);

    // Hardware back button handlers (stack-based, order matters: lowest to highest priority)
    useHardwareBack(activeFolderId !== null, useCallback(() => {
        // Find parent folder and navigate up if possible. 
        // For now, just go to root since we don't have breadcrumbs state natively accessible here without a tree lookup.
        // Or better, just let it be null.
        setActiveFolderId(null);
    }, [setActiveFolderId]));

    useHardwareBack(selectedIds.length > 0, useCallback(() => {
        setSelectedIds([]);
    }, []));

    useHardwareBack(showMoveModal, useCallback(() => {
        setShowMoveModal(false);
    }, []));

    // Deep Link Handling
    useEffect(() => {
        const unlisten = onOpenUrl((urls) => {
            if (!urls || urls.length === 0) return;
            const urlStr = urls[0];
            try {
                const url = new URL(urlStr);
                if (url.protocol !== 'tgdrive:') return;
                
                const type = url.hostname; // 'file' or 'folder'
                const idStr = url.searchParams.get('id');
                const folderStr = url.searchParams.get('folder');
                
                if (!idStr) return;
                const targetId = parseInt(idStr, 10);
                
                if (type === 'folder') {
                    setActiveFolderId(targetId);
                } else if (type === 'file') {
                    const folderId = folderStr && folderStr !== 'null' ? parseInt(folderStr, 10) : null;
                    setActiveFolderId(folderId);
                    setPendingDeepLinkFileId(targetId);
                }
            } catch (e) {
                console.error("Failed to parse deep link", e);
            }
        });

        return () => {
            unlisten.then(fn => fn()).catch(console.error);
        };
    }, [setActiveFolderId]);

    useHardwareBack(!!previewFile || !!playingFile || !!pdfFile, useCallback(() => {
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
    }, []));

    useEffect(() => {
        if (store) {
            store.get<'grid' | 'list'>('viewMode').then((saved) => {
                if (saved) setViewMode(saved);
            });
        }
    }, [store]);

    useEffect(() => {
        if (store) {
            store.set('viewMode', viewMode).then(() => store.save());
        }
    }, [store, viewMode]);


    const { data: allFiles = [], isLoading, error, refetch } = useQuery({
        queryKey: ['files', activeAccountId, activeFolderId],
        queryFn: async () => {
            if (!activeAccountId || !isSessionReady) return [];
            return await invoke<TelegramFile[]>('cmd_get_files', { folderId: activeFolderId });
        },
        enabled: isSessionReady && activeAccountId !== null,
        refetchInterval: 30000,
    });

    const displayedFiles = searchTerm.length > 2
        ? searchResults
        : allFiles.filter((f: TelegramFile) => f.name.toLowerCase().includes(searchTerm.toLowerCase()));

    const { data: bandwidth } = useQuery({
        queryKey: ['bandwidth'],
        queryFn: () => invoke<BandwidthStats>('cmd_get_bandwidth'),
        refetchInterval: 5000,
        enabled: !!store
    });

    // Handle opening the pending deep link file once it loads
    useEffect(() => {
        if (pendingDeepLinkFileId && allFiles.length > 0) {
            const file = allFiles.find((f: TelegramFile) => f.id === pendingDeepLinkFileId);
            if (file) {
                // handlePreview is hoisted by JS or we can just set the state directly
                if (isMediaFile(file.name)) {
                    setPlayingFile(file);
                } else if (isPdfFile(file.name)) {
                    setPdfFile(file);
                } else {
                    setPreviewFile(file);
                }
                setPreviewContextFiles(allFiles);
                setPreviewContextIndex(allFiles.indexOf(file));
                setSelectedIds([file.id]);
                setPendingDeepLinkFileId(null);
                toast.success("Opened shared file");
            }
        }
    }, [pendingDeepLinkFileId, allFiles]);


    const {
        handleDelete, handleBulkDelete, handleBulkDownload,
        handleBulkMove, handleDownloadFolder, handleGlobalSearch

    } = useFileOperations(activeFolderId, selectedIds, setSelectedIds, displayedFiles);

    const { uploadQueue, setUploadQueue, handleManualUpload, cancelAll: cancelUploads, cancelItem: cancelUploadItem, retryItem: retryUploadItem, isDragging } = useFileUpload(activeFolderId, store, allFiles);
    const { downloadQueue, queueDownload, clearFinished: clearDownloads, cancelAll: cancelDownloads, cancelItem: cancelDownloadItem, retryItem: retryDownloadItem } = useFileDownload(store);


    const handleSelectAll = useCallback(() => {
        setSelectedIds(displayedFiles.map(f => f.id));
    }, [displayedFiles]);

    const handleKeyboardDelete = useCallback(() => {
        if (selectedIds.length > 0) {
            handleBulkDelete();
        }
    }, [selectedIds, handleBulkDelete]);

    const handleEscape = useCallback(() => {
        setSelectedIds([]);
        setSearchTerm("");
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
    }, []);

    const handleFocusSearch = useCallback(() => {
        const searchInput = document.querySelector('input[placeholder="Search files..."]') as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }, []);

    const handleEnter = useCallback(() => {
        if (selectedIds.length === 1) {
            const selected = displayedFiles.find(f => f.id === selectedIds[0]);
            if (selected) {
                if (selected.type === 'folder') {
                    setActiveFolderId(selected.id);
                } else {
                    handlePreview(selected, displayedFiles);
                }
            }
        }
    }, [selectedIds, displayedFiles, setActiveFolderId]);

    useKeyboardShortcuts({
        onSelectAll: handleSelectAll,
        onDelete: handleKeyboardDelete,
        onEscape: handleEscape,
        onSearch: handleFocusSearch,
        onEnter: handleEnter,
        enabled: !previewFile && !playingFile && !pdfFile && !showMoveModal // Disable when modals are open
    });


    useEffect(() => {
        setSelectedIds([]);
        setShowMoveModal(false);
        setSearchTerm("");
        setSearchResults([]);
        setPreviewFile(null);
        setPlayingFile(null);
        setPdfFile(null);
        setPreviewContextFiles([]);
        setPreviewContextIndex(-1);
    }, [activeFolderId]);


    useEffect(() => {
        if (searchTerm.length <= 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearching(true);
            const results = await handleGlobalSearch(searchTerm);
            setSearchResults(results);
            setIsSearching(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [searchTerm]);




    const handleFileClick = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        const file = displayedFiles.find(f => f.id === id) || searchResults.find(f => f.id === id);
        if (!file) return;

        if (e.metaKey || e.ctrlKey || selectedIds.length > 0) {
            setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
            return;
        }

        if (file.type === 'folder') {
            setActiveFolderId(file.id);
            setSearchTerm('');
        } else {
            handlePreview(file);
        }
    }

    const handleToggleSelection = useCallback((id: number) => {
        setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
    }, []);

    const handlePreview = (file: TelegramFile, orderedFiles?: TelegramFile[]) => {
        const contextFiles = (orderedFiles || displayedFiles).filter((f) => f.type !== 'folder');
        const contextIndex = contextFiles.findIndex((f) => f.id === file.id);

        setPreviewContextFiles(contextFiles);
        setPreviewContextIndex(contextIndex);

        const isMedia = isMediaFile(file.name);
        const isPdf = isPdfFile(file.name);
        const isImg = file.name ? file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i) : false;

        if (isMedia) {
            setPlayingFile(file);
            setPreviewFile(null);
            setPdfFile(null);
        } else if (isPdf) {
            setPdfFile(file);
            setPreviewFile(null);
            setPlayingFile(null);
        } else if (isImg) {
            setPreviewFile(file);
            setPlayingFile(null);
            setPdfFile(null);
        } else {
            // Auto-download generic files instead of showing unsupported preview
            queueDownload(file.id, file.name, activeFolderId);
        }
    };

    const navigatePreview = useCallback((step: 1 | -1) => {
        if (previewContextFiles.length === 0) return;
        if (previewContextIndex === -1) return;
        const nextIndex = (previewContextIndex + step + previewContextFiles.length) % previewContextFiles.length;
        handlePreview(previewContextFiles[nextIndex], previewContextFiles);
    }, [previewContextFiles, previewContextIndex]);

    const handleNextPreview = useCallback(() => navigatePreview(1), [navigatePreview]);
    const handlePrevPreview = useCallback(() => navigatePreview(-1), [navigatePreview]);

    const handleRename = async (id: number, newName: string) => {
        try {
            await invoke('cmd_rename_file', { messageId: id, folderId: activeFolderId, newName });
            queryClient.invalidateQueries({ queryKey: ['files', activeAccountId, activeFolderId] });
            toast.success("File renamed");
        } catch (e) {
            toast.error("Failed to rename file: " + e);
        }
    };

    const handleDeduplicate = async () => {
        if (!await confirm({ title: "Clean Duplicates", message: "Scan the current folder and delete exact duplicate files (same name & size)? Only one copy will be kept.", confirmText: "Clean Now", variant: 'danger' })) return;
        
        try {
            const toastId = toast.loading("Scanning for duplicates...");
            const deletedCount: number = await invoke('cmd_deduplicate_folder', { folderId: activeFolderId });
            toast.dismiss(toastId);
            if (deletedCount > 0) {
                toast.success(`Removed ${deletedCount} duplicate file(s)`);
                queryClient.invalidateQueries({ queryKey: ['files', activeAccountId, activeFolderId] });
            } else {
                toast.info("No duplicates found in this folder");
            }
        } catch (e) {
            toast.error("Failed to clean duplicates: " + e);
        }
    };

    const previewNeighborFiles = useCallback(() => {
        if (previewContextFiles.length === 0) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentFileId = previewFile?.id ?? playingFile?.id ?? pdfFile?.id;
        if (!currentFileId) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const currentIdx = previewContextFiles.findIndex((f) => f.id === currentFileId);
        if (currentIdx === -1) {
            return { nextFile: null as TelegramFile | null, prevFile: null as TelegramFile | null };
        }

        const nextIdx = (currentIdx + 1) % previewContextFiles.length;
        const prevIdx = (currentIdx - 1 + previewContextFiles.length) % previewContextFiles.length;

        return {
            nextFile: previewContextFiles[nextIdx] || null,
            prevFile: previewContextFiles[prevIdx] || null,
        };
    }, [previewContextFiles, previewFile, playingFile, pdfFile]);

    const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: number | null) => {
        e.preventDefault();
        e.stopPropagation();

        const dataTransferFileId = e.dataTransfer.getData("application/x-telegram-file-id");

        if (activeFolderId === targetFolderId) return;

        const fileId = internalDragRef.current || (dataTransferFileId ? parseInt(dataTransferFileId) : null);

        if (fileId) {
            try {
                const idsToMove = selectedIds.includes(fileId) ? selectedIds : [fileId];

                await invoke('cmd_move_files', {
                    messageIds: idsToMove,
                    sourceFolderId: activeFolderId,
                    targetFolderId: targetFolderId
                });

                queryClient.invalidateQueries({ queryKey: ['files'] });

                if (selectedIds.includes(fileId)) setSelectedIds([]);

                toast.success(`Moved ${idsToMove.length} file(s).`);

                setInternalDragFileId(null);
            } catch {
                toast.error(`Failed to move file(s).`);
            }
        }
    }

    const currentFolderName = activeFolderId === null
        ? "Saved Messages"
        : folders.find(f => f.id === activeFolderId)?.name || "Folder";


    const handleRootDragOver = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const handleRootDragEnter = (e: React.DragEvent) => {
        if (internalDragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    };

    const previewNeighbors = previewNeighborFiles();

    return (
        <div 
            className="flex flex-col md:flex-row h-[100dvh] w-full bg-telegram-bg text-telegram-text overflow-hidden relative selection:bg-telegram-primary/30"
            onClick={() => {
                setSelectedIds([]);
                if (isSidebarOpen) setIsSidebarOpen(false);
            }}
            onDragOver={handleRootDragOver}
            onDragEnter={handleRootDragEnter}
        >

            <ExternalDropBlocker onUploadClick={handleManualUpload} />

            <AnimatePresence>
                {showMoveModal && (
                    <MoveToFolderModal
                        folders={folders}
                        onClose={() => setShowMoveModal(false)}
                        onSelect={handleBulkMove}
                        activeFolderId={activeFolderId}
                        key="move-modal"
                    />
                )}
                {playingFile && (
                    <MediaPlayer
                        file={playingFile}
                        onClose={() => setPlayingFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="media-player"
                    />
                )}
                {pdfFile && (
                    <PdfViewer
                        file={pdfFile}
                        onClose={() => setPdfFile(null)}
                        onNext={handleNextPreview}
                        onPrev={handlePrevPreview}
                        currentIndex={previewContextIndex}
                        totalItems={previewContextFiles.length}
                        activeFolderId={activeFolderId}
                        key="pdf-viewer"
                    />
                )}
                {isDragging && internalDragFileId === null && <DragDropOverlay key="drag-drop-overlay" />}
            </AnimatePresence>

            <Sidebar
                folders={folders}
                unlockedVaults={unlockedVaults}
                handleUnlockVault={handleUnlockVault}
                handleLockVault={handleLockVault}
                activeFolderId={activeFolderId}
                setActiveFolderId={setActiveFolderId}
                onDrop={handleDropOnFolder}
                onDelete={handleFolderDelete}
                onCreate={handleCreateFolder}
                isSyncing={isSyncing}
                isConnected={isConnected}
                onSync={handleSyncFolders}
                onLogout={handleLogout}
                bandwidth={bandwidth || null}
                accounts={accounts}
                activeAccountId={activeAccountId}
                onSwitchAccount={handleSwitchAccount}
                onAddAccount={onAddAccount}
                onRemoveAccount={handleRemoveAccount}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />

            <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" onClick={(e) => { if (e.target === e.currentTarget) setSelectedIds([]); }}>
                <TopBar
                    currentFolderName={currentFolderName}
                    selectedIds={selectedIds}
                    onShowMoveModal={() => setShowMoveModal(true)}
                    onBulkDownload={handleBulkDownload}
                    onBulkDelete={handleBulkDelete}
                    onDownloadFolder={handleDownloadFolder}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleSidebar={() => setIsSidebarOpen(true)}
                    onDeduplicate={handleDeduplicate}
                />
                {searchTerm.length > 2 && (
                    <div className="px-6 pt-4 pb-0">
                        <h2 className="text-sm font-medium text-telegram-subtext">
                            Search Results for <span className="text-telegram-primary">"{searchTerm}"</span>
                        </h2>
                    </div>
                )}
                <FileExplorer

                    files={displayedFiles}
                    loading={isLoading || isSearching}
                    error={error}
                    viewMode={viewMode}
                    selectedIds={selectedIds}
                    activeFolderId={activeFolderId}
                    onFileClick={handleFileClick}
                    onDelete={handleDelete}
                    onDownload={(id, name) => queueDownload(id, name, activeFolderId)}
                    onPreview={handlePreview}
                    onManualUpload={handleManualUpload}
                    onSelectionClear={() => setSelectedIds([])}
                    onToggleSelection={handleToggleSelection}
                    onDrop={handleDropOnFolder}
                    onDragStart={(fileId) => setInternalDragFileId(fileId)}
                    onDragEnd={() => setTimeout(() => setInternalDragFileId(null), 50)}
                    onRename={handleRename}
                    onRefresh={refetch}
                />
            </main>

            {previewFile && (
                <PreviewModal
                    file={previewFile}
                    activeFolderId={activeFolderId}
                    onClose={() => setPreviewFile(null)}
                    onNext={handleNextPreview}
                    onPrev={handlePrevPreview}
                    currentIndex={previewContextIndex}
                    totalItems={previewContextFiles.length}
                    nextFile={previewNeighbors.nextFile}
                    prevFile={previewNeighbors.prevFile}
                />
            )}


            <UploadQueue
                items={uploadQueue}
                onClearFinished={() => setUploadQueue(q => q.filter(i => i.status !== 'success' && i.status !== 'error' && i.status !== 'cancelled'))}
                onCancelAll={cancelUploads}
                onCancelItem={cancelUploadItem}
                onRetryItem={retryUploadItem}
            />
            <DownloadQueue
                items={downloadQueue}
                onClearFinished={clearDownloads}
                onCancelAll={cancelDownloads}
                onCancelItem={cancelDownloadItem}
                onRetryItem={retryDownloadItem}
            />
        </div>
    );
}
