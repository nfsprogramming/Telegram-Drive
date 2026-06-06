import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, ArrowUpDown, ArrowUp, ArrowDown, Upload, Check, RefreshCcw, Loader2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileCard } from './FileCard';
import { EmptyState } from './EmptyState';
import { TelegramFile } from '../../types';
import { ContextMenu } from './ContextMenu';
import { FileListItem } from './FileListItem';
import { RenameModal } from './RenameModal';
import { FileDetailsModal } from './FileDetailsModal';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useHardwareBack } from '../../hooks/useHardwareBack';

type SortField = 'name' | 'size' | 'date';
type SortDirection = 'asc' | 'desc';

interface FileExplorerProps {
    files: TelegramFile[];
    loading: boolean;
    error: Error | null;
    viewMode: 'grid' | 'list';
    selectedIds: number[];
    activeFolderId: number | null;
    onFileClick: (e: React.MouseEvent, id: number) => void;
    onDelete: (id: number) => void;
    onDownload: (id: number, name: string) => void;
    onPreview: (file: TelegramFile, orderedFiles?: TelegramFile[]) => void;
    onManualUpload: () => void;
    onSelectionClear: () => void;
    onToggleSelection: (id: number) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onRename?: (id: number, name: string) => void;
    onRefresh?: () => Promise<any> | void;
}


function useGridColumns(containerRef: React.RefObject<HTMLDivElement | null>, isReady: boolean) {
    const [columns, setColumns] = useState(4);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        if (!isReady || !containerRef.current) return;

        const updateColumns = () => {
            if (!containerRef.current) return;
            let width = containerRef.current.clientWidth;
            if (!width || width === 0) width = window.innerWidth;
            
            // Subtract container padding (p-4 = 16px*2, md:p-6 = 24px*2)
            const padding = window.innerWidth >= 768 ? 48 : 32;
            width -= padding;
            
            width = Math.min(width, window.innerWidth - padding);

            setContainerWidth(width);
            if (width < 640) setColumns(2); // Mobile
            else if (width < 1024) setColumns(3); // Tablet
            else if (width < 1280) setColumns(4); // Tablet/Desktop
            else if (width < 1536) setColumns(5); // Desktop
            else if (width < 1920) setColumns(6); // Large Desktop
            else setColumns(8); // Ultra wide
        };

        updateColumns();
        
        let observer: ResizeObserver | null = null;
        try {
            observer = new ResizeObserver(updateColumns);
            observer.observe(containerRef.current);
        } catch (e) {
            window.addEventListener('resize', updateColumns);
        }
        
        return () => {
            if (observer) observer.disconnect();
            window.removeEventListener('resize', updateColumns);
        };
    }, [containerRef, isReady]);

    return { columns, containerWidth };
}

export function FileExplorer({
    files, loading, error, viewMode, selectedIds, activeFolderId,
    onFileClick, onDelete, onDownload, onPreview, onManualUpload, onSelectionClear, onToggleSelection, onDrop, onDragStart, onDragEnd, onRename, onRefresh
}: FileExplorerProps) {
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: TelegramFile } | null>(null);
    const [renameModalFile, setRenameModalFile] = useState<TelegramFile | null>(null);
    const [detailsModalFile, setDetailsModalFile] = useState<TelegramFile | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isFabOpen, setIsFabOpen] = useState(false);
    const [animKey, setAnimKey] = useState(0);
    const prevFolderRef = useRef(activeFolderId);
    const prevViewRef = useRef(viewMode);
    useEffect(() => {
        if (prevFolderRef.current !== activeFolderId || prevViewRef.current !== viewMode) {
            setAnimKey(k => k + 1);
            prevFolderRef.current = activeFolderId;
            prevViewRef.current = viewMode;
        }
    }, [activeFolderId, viewMode]);

    // Hardware back bindings for internal states
    useHardwareBack(isFabOpen, useCallback(() => setIsFabOpen(false), []));
    useHardwareBack(!!contextMenu, useCallback(() => setContextMenu(null), []));
    useHardwareBack(!!detailsModalFile, useCallback(() => setDetailsModalFile(null), []));
    useHardwareBack(!!renameModalFile, useCallback(() => setRenameModalFile(null), []));

    // Pull to refresh logic
    const [pullDistance, setPullDistance] = useState(0);
    const touchStartY = useRef(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (parentRef.current?.scrollTop === 0) {
            touchStartY.current = e.touches[0].clientY;
        } else {
            touchStartY.current = 0;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStartY.current === 0) return;
        const y = e.touches[0].clientY;
        const distance = y - touchStartY.current;
        if (distance > 0 && parentRef.current?.scrollTop === 0) {
            setPullDistance(Math.min(distance * 0.4, 80));
        }
    };

    const handleTouchEnd = async () => {
        if (pullDistance > 60 && onRefresh && !isRefreshing) {
            setIsRefreshing(true);
            setPullDistance(60);
            try {
                await onRefresh();
            } finally {
                setIsRefreshing(false);
                setPullDistance(0);
            }
        } else {
            setPullDistance(0);
        }
        touchStartY.current = 0;
    };

    const parentRef = useRef<HTMLDivElement>(null);
    const isReady = !loading && !error && files.length > 0;
    const { columns, containerWidth } = useGridColumns(parentRef, isReady);

    const GAP = 6;
    const cardWidth = (containerWidth - (GAP * (columns - 1))) / columns;
    const cardHeight = cardWidth * 0.75;
    const rowHeight = cardHeight + GAP;

    const handleContextMenu = useCallback((e: React.MouseEvent | React.UIEvent, file: TelegramFile) => {
        e.preventDefault();
        e.stopPropagation();
        
        let x = 0;
        let y = 0;
        
        // If it's a mouse event with clientX/Y
        if ('clientX' in e) {
            x = e.clientX;
            y = e.clientY;
        } else {
            // If triggered from button click, fallback to target element rect
            const target = e.target as HTMLElement;
            const rect = target.getBoundingClientRect();
            x = rect.left;
            y = rect.bottom;
        }
        
        setContextMenu({ x, y, file });
    }, []);

    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0);
                    break;
                case 'date':
                    comparison = (a.created_at || '').localeCompare(b.created_at || '');
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [files, sortField, sortDirection]);

    const handlePreviewRequest = useCallback((file: TelegramFile) => {
        onPreview(file, sortedFiles);
    }, [onPreview, sortedFiles]);


    const gridRows = useMemo(() => {
        const rows: TelegramFile[][] = [];
        for (let i = 0; i < sortedFiles.length; i += columns) {
            rows.push(sortedFiles.slice(i, i + columns));
        }
        return rows;
    }, [sortedFiles, columns]);

    const listItems = useMemo(() => {
        return sortedFiles;
    }, [sortedFiles]);


    const gridVirtualizer = useVirtualizer({
        count: gridRows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => rowHeight, [rowHeight]),
        overscan: 2,
        gap: GAP,
    });


    useEffect(() => {
        gridVirtualizer.measure();
    }, [rowHeight, gridVirtualizer]);

    const listVirtualizer = useVirtualizer({
        count: listItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 48,
        overscan: 5,
    });

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
        return sortDirection === 'asc'
            ? <ArrowUp className="w-3 h-3 text-telegram-primary" />
            : <ArrowDown className="w-3 h-3 text-telegram-primary" />;
    };

    if (loading) {
        return (
            <div className="flex-1 p-6 flex justify-center items-center text-telegram-subtext flex-col gap-4 relative">
                <div className="w-8 h-8 border-4 border-telegram-primary border-t-transparent rounded-full animate-spin"></div>
                Loading your files...
            </div>
        )
    }

    if (error) {
        return <div className="flex-1 p-6 flex justify-center items-center text-red-400">Error loading files</div>
    }

    if (files.length === 0) {
        return (
            <div className="flex-1 p-6 overflow-auto">
                <EmptyState onUpload={onManualUpload} />
            </div>
        );
    }

    return (
        <div className="flex-1 relative overflow-hidden bg-telegram-bg" onClick={() => setIsFabOpen(false)}>
            <div 
                className={`absolute inset-0 overflow-y-auto overflow-x-hidden custom-scrollbar touch-pan-y select-none animate-folder-in p-4 md:p-6`} 
                key={animKey}
                ref={parentRef}
                onContextMenu={(e) => {
                    e.preventDefault();
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (e.target === e.currentTarget) onSelectionClear();
                    setIsFabOpen(false);
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
            {/* Pull to Refresh Indicator */}
            {(pullDistance > 0 || isRefreshing) && (
                <div 
                    className="sticky top-0 left-0 w-full flex justify-center z-50 pointer-events-none transition-transform duration-200 ease-out -mt-6 mb-6"
                    style={{ transform: `translateY(${Math.min(pullDistance, 80)}px)` }}
                >
                    <div className="bg-telegram-header/90 backdrop-blur px-4 py-2 rounded-full shadow-lg border border-telegram-border flex items-center gap-2 text-telegram-primary text-sm font-medium">
                        {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" style={{ transform: `rotate(${pullDistance * 5}deg)` }} />}
                    </div>
                </div>
            )}
            {viewMode === 'grid' ? (
                <>

                    <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-telegram-subtext">
                        <span>Sort by:</span>
                        <button
                            onClick={() => handleSort('name')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'name' ? 'text-telegram-primary' : ''}`}
                        >
                            Name <SortIcon field="name" />
                        </button>
                        <button
                            onClick={() => handleSort('size')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'size' ? 'text-telegram-primary' : ''}`}
                        >
                            Size <SortIcon field="size" />
                        </button>
                        <button
                            onClick={() => handleSort('date')}
                            className={`px-2 py-1 rounded flex items-center gap-1 hover:bg-white/5 ${sortField === 'date' ? 'text-telegram-primary' : ''}`}
                        >
                            Date <SortIcon field="date" />
                        </button>
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${gridVirtualizer.getTotalSize()}px` }}
                    >
                        {gridVirtualizer.getVirtualItems().map((virtualRow) => {
                            const row = gridRows[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    className="absolute top-0 left-0 w-full grid"
                                    style={{
                                        height: `${cardHeight}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                        gap: `${GAP}px`,
                                    }}
                                >
                                    {row.map((file) => {
                                        return (
                                            <FileCard
                                                key={file.id}
                                                file={file}
                                                isSelected={selectedIds.includes(file.id)}
                                                onClick={(e) => onFileClick(e, file.id)}
                                                onContextMenu={(e) => handleContextMenu(e, file)}
                                                onDelete={() => onDelete(file.id)}
                                                onDownload={() => onDownload(file.id, file.name)}
                                                onPreview={() => handlePreviewRequest(file)}
                                                onDrop={onDrop}
                                                onDragStart={onDragStart}
                                                onDragEnd={onDragEnd}
                                                activeFolderId={activeFolderId}
                                                height={cardHeight}
                                                onToggleSelection={() => onToggleSelection(file.id)}
                                                selectionMode={selectedIds.length > 0}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="flex flex-col w-full">
                    {/* List Header */}
                    <div className="flex items-center gap-2 sm:gap-4 px-2 sm:px-4 py-2 text-[10px] sm:text-xs font-semibold text-telegram-subtext border-b border-telegram-border mb-2 select-none sticky top-0 bg-telegram-bg z-10">
                        <div className="w-8 shrink-0 text-center flex items-center justify-center">
                            {/* Checkbox Placeholder for select all */}
                            <Check className="w-4 h-4 opacity-50" />
                        </div>
                        <div className="w-8 sm:w-10 shrink-0 text-center"></div> {/* Icon placeholder */}
                        <button onClick={() => handleSort('name')} className="flex-1 min-w-0 flex items-center gap-1 hover:text-telegram-text transition-colors">
                            Name <SortIcon field="name" />
                        </button>
                        <button onClick={() => handleSort('size')} className="hidden sm:flex w-24 shrink-0 items-center justify-end gap-1 hover:text-telegram-text transition-colors">
                            Size <SortIcon field="size" />
                        </button>
                        <div className="hidden md:block w-20 shrink-0 text-right">Type</div>
                        <button onClick={() => handleSort('date')} className="hidden lg:flex w-32 shrink-0 items-center justify-end gap-1 hover:text-telegram-text transition-colors pr-4">
                            Date <SortIcon field="date" />
                        </button>
                        <div className="w-10 sm:w-32 shrink-0 text-right"></div> {/* Actions */}
                    </div>


                    <div
                        className="relative w-full"
                        style={{ height: `${listVirtualizer.getTotalSize()}px` }}
                    >
                        {listVirtualizer.getVirtualItems().map((virtualItem) => {
                            const item = listItems[virtualItem.index];
                            const file = item;
                            return (
                                <div
                                    key={file.id}
                                    className="absolute top-0 left-0 w-full"
                                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                                >
                                    <FileListItem
                                        file={file}
                                        selectedIds={selectedIds}
                                        onFileClick={onFileClick}
                                        handleContextMenu={handleContextMenu}
                                        onDrop={onDrop}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
                                        onPreview={() => handlePreviewRequest(file)}
                                        onDownload={onDownload}
                                        onDelete={onDelete}
                                        selectionMode={selectedIds.length > 0}
                                        onToggleSelection={() => onToggleSelection(file.id)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    file={contextMenu.file}
                    onClose={() => setContextMenu(null)}
                    onDownload={() => {
                        onDownload(contextMenu.file.id, contextMenu.file.name);
                        setContextMenu(null);
                    }}
                    onDelete={() => {
                        onDelete(contextMenu.file.id);
                        setContextMenu(null);
                    }}
                    onPreview={() => {
                        if (contextMenu.file.type === 'folder') {
                            onFileClick({ preventDefault: () => { }, stopPropagation: () => { } } as React.MouseEvent, contextMenu.file.id);
                        } else {
                            handlePreviewRequest(contextMenu.file);
                        }
                        setContextMenu(null);
                    }}
                    onRename={() => {
                        setRenameModalFile(contextMenu.file);
                        setContextMenu(null);
                    }}
                    onDuplicate={() => {
                        invoke('cmd_duplicate_files', { messageIds: [contextMenu.file.id], folderId: activeFolderId }).then(() => {
                            toast.success(`Duplicated ${contextMenu.file.name}`);
                            if (onRefresh) onRefresh();
                        }).catch(e => {
                            toast.error(`Failed to duplicate: ${e}`);
                        });
                        setContextMenu(null);
                    }}
                    onDetails={() => {
                        setDetailsModalFile(contextMenu.file);
                        setContextMenu(null);
                    }}
                />
            )}

            {detailsModalFile && (
                <div className="animate-sheet-up">
                <FileDetailsModal 
                    file={detailsModalFile}
                    onClose={() => setDetailsModalFile(null)}
                />
                </div>
            )}

            {renameModalFile && (
                <div className="animate-sheet-up">
                <RenameModal
                    file={renameModalFile}
                    onClose={() => setRenameModalFile(null)}
                    onRename={(id, newName) => {
                        if (onRename) onRename(id, newName);
                        setRenameModalFile(null);
                    }}
                />
                </div>
            )}

            </div>

            {/* FAB for Upload - Moved outside scroll container so it stays fixed */}
            <div 
                className="absolute bottom-6 right-6 flex flex-col items-end gap-3 z-30"
                onMouseEnter={() => setIsFabOpen(true)}
                onMouseLeave={() => setIsFabOpen(false)}
            >
                <div className={`flex flex-col gap-2 items-end transition-all duration-200 absolute bottom-16 right-0 ${isFabOpen ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible translate-y-2'}`}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsFabOpen(false); onManualUpload(); }}
                        className="flex items-center gap-2 px-4 py-2 bg-telegram-surface border border-telegram-border rounded-full shadow-lg text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover transition-all whitespace-nowrap"
                    >
                        <span className="text-sm font-medium">Upload File</span>
                        <Upload className="w-4 h-4" />
                    </button>
                </div>
                
                <button
                    onClick={(e) => { e.stopPropagation(); setIsFabOpen(!isFabOpen); }}
                    className="w-14 h-14 bg-telegram-primary hover:bg-telegram-primary/90 text-white rounded-full flex items-center justify-center shadow-[0_4px_20px_rgba(198,37,36,0.4)] transition-all hover:scale-105"
                >
                    <Plus className={`w-6 h-6 transition-transform duration-200 ${isFabOpen ? 'rotate-45' : ''}`} />
                </button>
            </div>
        </div>
    )
}
