import React, { useState, useRef } from 'react';
import { Folder, HardDrive, Trash2, MoreVertical } from 'lucide-react';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { formatBytes } from '../../utils';

interface FileListItemProps {
    file: TelegramFile;
    selectedIds: number[];
    onFileClick: (e: React.MouseEvent, id: number) => void;
    handleContextMenu: (e: React.MouseEvent, file: TelegramFile) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onPreview: (file: TelegramFile) => void;
    onDownload: (id: number, name: string) => void;
    onDelete: (id: number) => void;
    selectionMode?: boolean;
    onToggleSelection?: () => void;
}

export const FileListItem = React.memo(function FileListItem({
    file, selectedIds, onFileClick, handleContextMenu,
    onDragStart, onDragEnd, onDrop,
    onDownload, onDelete, selectionMode, onToggleSelection
}: FileListItemProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const isFolder = file.type === 'folder';
    const isSelected = selectedIds.includes(file.id);

    const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartPos = useRef<{ x: number; y: number } | null>(null);
    const didLongPress = useRef(false);

    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        touchStartPos.current = { x: touch.clientX, y: touch.clientY };
        didLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            if (onToggleSelection) onToggleSelection();
            if (window.navigator.vibrate) window.navigator.vibrate(50);
        }, 500);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!touchStartPos.current) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - touchStartPos.current.x);
        const dy = Math.abs(touch.clientY - touchStartPos.current.y);
        if (dx > 10 || dy > 10) clearLongPress();
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        clearLongPress();
        if (didLongPress.current) {
            e.preventDefault();
            didLongPress.current = false;
        }
    };

    const clearLongPress = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
    };

    // Get file extension for type column
    const fileExt = isFolder ? 'Folder' : (file.name.split('.').pop()?.toUpperCase() || 'FILE');
    
    // Format date
    const dateStr = file.created_at ? new Date(file.created_at).toLocaleDateString() : '-';

    return (
        <div
            onClick={(e) => {
                if (!didLongPress.current) onFileClick(e, file.id);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                if (isTouch && onToggleSelection) {
                    onToggleSelection();
                } else {
                    handleContextMenu(e, file);
                }
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            draggable={!isFolder && !isTouch}
            onDragStart={(e) => {
                if (onDragStart) onDragStart(file.id);
                e.dataTransfer.setData("application/x-telegram-file-id", file.id.toString());
                e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
                if (onDragEnd) onDragEnd();
            }}
            onDragOver={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!isDragOver) setIsDragOver(true);
                }
            }}
            onDragLeave={(e) => {
                if (isFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                }
            }}
            onDrop={(e) => {
                if (isFolder && onDrop) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    onDrop(e, file.id);
                }
            }}
            className={`group flex items-center px-2 sm:px-4 py-2 sm:py-3 gap-2 sm:gap-4 rounded-lg cursor-pointer border border-transparent transition-all hover:bg-white/5 select-none
                ${isSelected ? 'bg-telegram-primary/10 border-telegram-primary/20' : ''}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20' : ''}
            `}
        >
            {/* Checkbox */}
            <div 
                className={`w-8 shrink-0 flex items-center justify-center transition-opacity ${selectionMode || isSelected ? 'opacity-100' : 'opacity-0 md:group-hover:opacity-100'}`}
                onClick={(e) => {
                    e.stopPropagation();
                    e.ctrlKey = true;
                    onFileClick(e as unknown as React.MouseEvent, file.id);
                }}
            >
                <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded border flex items-center justify-center transition-colors
                    ${isSelected ? 'bg-telegram-primary border-telegram-primary' : 'border-telegram-border group-hover:border-telegram-primary/50'}`}>
                    {isSelected && <div className="w-2 h-2 bg-white rounded-[1px]" />}
                </div>
            </div>

            {/* Icon */}
            <div className="w-8 sm:w-10 shrink-0 flex justify-center items-center">
                {isFolder ? <Folder className="w-6 h-6 text-telegram-primary" /> : <FileTypeIcon filename={file.name} className="w-6 h-6" />}
            </div>

            {/* Name and Mobile details */}
            <div className="flex-1 min-w-0 flex flex-col justify-center py-1">
                <span className="text-sm text-telegram-text font-medium truncate">{file.name}</span>
                {/* Mobile Details: shown only on small screens */}
                <span className="sm:hidden text-[11px] text-telegram-subtext flex gap-2 mt-0.5">
                    <span>{file.sizeStr || formatBytes(file.size ?? 0)}</span>
                    <span>•</span>
                    <span>{dateStr}</span>
                </span>
            </div>

            {/* Desktop Columns */}
            <div className="hidden sm:block w-24 shrink-0 text-right text-xs text-telegram-subtext truncate">{file.sizeStr || formatBytes(file.size ?? 0)}</div>
            <div className="hidden md:block w-20 shrink-0 text-right text-xs text-telegram-subtext font-mono truncate">{fileExt}</div>
            <div className="hidden lg:block w-32 shrink-0 text-right text-xs text-telegram-subtext truncate pr-4">{dateStr}</div>

            {/* Actions */}
            <div className="w-10 sm:w-32 shrink-0 flex items-center justify-end">
                {/* Desktop Inline Actions - hidden on mobile, shown on hover */}
                <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onDownload(file.id, file.name) }} className="p-1.5 hover:bg-white/10 text-telegram-subtext hover:text-white rounded transition-colors" title="Download">
                        <HardDrive className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(file.id) }} className="p-1.5 hover:bg-red-500/20 text-telegram-subtext hover:text-red-400 rounded transition-colors" title="Delete">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
                
                {/* 3-Dot Menu - Always visible on mobile, shown on hover on desktop */}
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        handleContextMenu(e, file); 
                    }} 
                    className="p-1.5 ml-1 sm:opacity-0 group-hover:opacity-100 hover:bg-white/10 text-telegram-subtext hover:text-white rounded transition-all" 
                    title="More Options"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.file.id === nextProps.file.id &&
           prevProps.selectedIds.includes(prevProps.file.id) === nextProps.selectedIds.includes(nextProps.file.id) &&
           prevProps.selectionMode === nextProps.selectionMode;
});

