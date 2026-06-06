import React, { useState, useEffect, useRef } from 'react';
import { Folder, Eye, Trash2, MoreVertical, Download } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { TelegramFile } from '../../types';
import { FileTypeIcon } from '../FileTypeIcon';
import { formatBytes } from '../../utils';

interface FileCardProps {
    file: TelegramFile;
    onDelete: () => void;
    onDownload: () => void;
    onPreview?: () => void;
    isSelected: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onDrop?: (e: React.DragEvent, folderId: number) => void;
    onDragStart?: (fileId: number) => void;
    onDragEnd?: () => void;
    activeFolderId?: number | null;
    height?: number;
    onToggleSelection?: () => void;
    selectionMode?: boolean;
}

// Check if file is an image type that can have a thumbnail
function isImageFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
}

export const FileCard = React.memo(function FileCard({
    file, onDelete, onDownload, onPreview, isSelected, onClick,
    onContextMenu, onDrop, onDragStart, onDragEnd, activeFolderId, height = 200,
    onToggleSelection, selectionMode
}: FileCardProps) {
    const isFolder = file.type === 'folder';
    const [isDragOver, setIsDragOver] = useState(false);
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [thumbnailLoading, setThumbnailLoading] = useState(false);

    // Disable HTML5 drag on touch devices to prevent conflict with long-press
    const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    // Long press logic — touch-based so it doesn't conflict with drag-and-drop
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
        // If finger moves more than 10px it's a scroll/drag — cancel long press
        if (dx > 10 || dy > 10) clearLongPress();
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        clearLongPress();
        // Suppress the click that follows a long press
        if (didLongPress.current) {
            e.preventDefault();
            didLongPress.current = false;
        }
    };

    const clearLongPress = () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
    };

    // Lazy load thumbnail for image files
    // Lazy load thumbnail for image files with a debounce to prevent IPC spam on fast scroll
    useEffect(() => {
        if (isFolder || !isImageFile(file.name)) return;

        let cancelled = false;
        
        const timer = setTimeout(() => {
            if (cancelled) return;
            setThumbnailLoading(true);
            invoke<string>('cmd_get_thumbnail', {
                messageId: file.id,
                folderId: activeFolderId
            }).then((result) => {
                if (!cancelled && result) {
                    setThumbnail(result);
                }
            }).catch(() => {
                // Silently fail - will show icon instead
            }).finally(() => {
                if (!cancelled) setThumbnailLoading(false);
            });
        }, 300); // 300ms delay

        return () => { 
            cancelled = true; 
            clearTimeout(timer);
        };
    }, [file.id, file.name, activeFolderId, isFolder]);

    return (
        <div
            className="relative"
            onContextMenu={onContextMenu}
            onClick={onClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
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
        >
            <div
                draggable={!isFolder && !isTouch}
                onDragStart={(e: any) => {
                    if (onDragStart) onDragStart(file.id);
                    e.dataTransfer.setData("application/x-telegram-file-id", file.id.toString());
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                    if (onDragEnd) onDragEnd();
                }}
                className={`group cursor-pointer bg-white/5 rounded-xl overflow-hidden border hover:shadow-lg transition-all relative flex flex-col
                ${isSelected ? 'border-telegram-primary bg-telegram-primary/10 ring-1 ring-telegram-primary' : 'border-telegram-border hover:border-white/20'}
                ${isDragOver ? 'ring-2 ring-telegram-primary bg-telegram-primary/20 scale-105' : ''}`}
                style={height ? { height: `${height}px` } : { aspectRatio: '4/4.5' }}
            >
                {/* Thumbnail Area - 65% */}
                <div className="relative h-[65%] w-full bg-black/20 flex-shrink-0">
                    {thumbnail ? (
                        <img
                            src={thumbnail}
                            alt={file.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                            {isFolder ? (
                                <Folder className="w-12 h-12 text-telegram-primary" />
                            ) : thumbnailLoading && isImageFile(file.name) ? (
                                <div className="w-8 h-8 border-2 border-telegram-primary/30 border-t-telegram-primary rounded-full animate-spin" />
                            ) : (
                                <FileTypeIcon filename={file.name} size="lg" className="w-12 h-12" />
                            )}
                        </div>
                    )}
                    
                    {/* Top Right Actions (Menu) */}
                    <div className="absolute top-2 right-2 flex gap-1 z-20">
                        <button 
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                if (onContextMenu) onContextMenu(e); 
                            }} 
                            className="p-1.5 bg-black/60 rounded-full hover:bg-black/80 text-white/90 transition-colors"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Quick actions on hover (Desktop only) */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex items-center justify-center gap-3 z-10">
                        {onPreview && !isFolder && (
                            <button onClick={(e) => { e.stopPropagation(); onPreview() }} className="p-2.5 bg-white/10 rounded-full hover:bg-telegram-primary text-white transition-colors" title="Preview">
                                <Eye className="w-5 h-5" />
                            </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onDownload() }} className="p-2.5 bg-white/10 rounded-full hover:bg-green-500 text-white transition-colors" title="Download">
                            <Download className="w-5 h-5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="p-2.5 bg-white/10 rounded-full hover:bg-red-500 text-white transition-colors" title="Delete">
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Selection Checkmark */}
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleSelection) onToggleSelection();
                    }}
                    className={`absolute top-2 left-2 w-5 h-5 rounded border flex items-center justify-center transition-all z-20 cursor-pointer 
                    ${isSelected ? 'bg-telegram-primary border-telegram-primary' : (selectionMode ? 'border-white/50 bg-black/40 opacity-100' : 'border-white/50 bg-black/40 opacity-0 md:group-hover:opacity-100')}`}
                >
                    {isSelected && <div className="w-2 h-2 bg-white rounded-[1px]" />}
                </div>

                {/* File info section - 35% */}
                <div className="flex flex-col flex-1 p-3 bg-transparent justify-between">
                    <h3 className="text-sm font-medium text-telegram-text line-clamp-2 leading-tight" title={file.name}>{file.name}</h3>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-telegram-subtext">
                        <span>{file.sizeStr || formatBytes(file.size ?? 0)}</span>
                        <span className="truncate ml-2">{file.created_at ? new Date(file.created_at).toLocaleDateString() : ''}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}, (prevProps, nextProps) => {
    return prevProps.file.id === nextProps.file.id &&
           prevProps.isSelected === nextProps.isSelected &&
           prevProps.selectionMode === nextProps.selectionMode &&
           prevProps.activeFolderId === nextProps.activeFolderId &&
           prevProps.height === nextProps.height;
});

