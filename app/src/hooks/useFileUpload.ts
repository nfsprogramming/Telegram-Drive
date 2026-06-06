import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TelegramFile, QueueItem } from '../types';
import { useFileDrop } from './useFileDrop';
import type { Store } from '@tauri-apps/plugin-store';
import { stat } from '@tauri-apps/plugin-fs';
import { runBackgroundIndexing } from '../services/indexer';

interface ProgressPayload {
    id: string;
    percent: number;
    uploaded_bytes: number;
    total_bytes: number;
    speed_bytes_per_sec: number;
}

export function useFileUpload(activeFolderId: number | null, store: Store | null, currentFiles: TelegramFile[] = []) {
    const queryClient = useQueryClient();
    const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
    const [processing, setProcessing] = useState(false);
    const [initialized, setInitialized] = useState(false);
    const cancelledRef = useRef<Set<string>>(new Set());

    // Listen for progress events from Rust
    useEffect(() => {
        let unlisten: UnlistenFn | undefined;
        listen<ProgressPayload>('upload-progress', (event) => {
            setUploadQueue(q => q.map(i =>
                i.id === event.payload.id ? {
                    ...i,
                    progress: event.payload.percent,
                    uploadedBytes: event.payload.uploaded_bytes,
                    totalBytes: event.payload.total_bytes,
                    speedBytesPerSec: event.payload.speed_bytes_per_sec,
                } : i
            ));
        }).then(fn => { unlisten = fn; });
        return () => { unlisten?.(); };
    }, []);

    useEffect(() => {
        if (!store || initialized) return;
        store.get<QueueItem[]>('uploadQueue').then((saved) => {
            if (saved && saved.length > 0) {
                const pending = saved.filter(i => i.status === 'pending');
                if (pending.length > 0) {
                    setUploadQueue(pending);
                    toast.info(`Restored ${pending.length} pending uploads`);
                }
            }
            setInitialized(true);
        });
    }, [store, initialized]);

    useEffect(() => {
        if (!store || !initialized) return;
        const pending = uploadQueue.filter(i => i.status === 'pending');
        store.set('uploadQueue', pending).then(() => store.save());
    }, [store, uploadQueue, initialized]);

    useEffect(() => {
        if (processing) return;
        const nextItem = uploadQueue.find(i => i.status === 'pending');
        if (nextItem) {
            processItem(nextItem);
        }
    }, [uploadQueue, processing]);

    const processItem = async (item: QueueItem) => {
        setProcessing(true);
        setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'uploading', progress: 0 } : i));
        try {
            const messageId: number = await invoke('cmd_upload_file', { path: item.path, folderId: item.folderId, transferId: item.id });
            // Check if cancelled during upload
            if (cancelledRef.current.has(item.id)) {
                cancelledRef.current.delete(item.id);
            } else {
                setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'success', progress: 100 } : i));
                
                // Trigger background indexing using the local file path!
                const fileName = item.path.split(/[\\/]/).pop() || 'file';
                // Try to guess mime type from extension
                const ext = fileName.split('.').pop()?.toLowerCase();
                let mimeType = 'application/octet-stream';
                if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext || '')) mimeType = `image/${ext}`;
                else if (ext === 'pdf') mimeType = 'application/pdf';
                else if (['txt', 'md', 'csv', 'json'].includes(ext || '')) mimeType = `text/${ext}`;
                
                // We use the tauri:// protocol or convertFileSrc to read the local file in the webview
                import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
                    const localUrl = convertFileSrc(item.path);
                    runBackgroundIndexing({
                        id: messageId,
                        folder_id: item.folderId,
                        name: fileName,
                        mime_type: mimeType
                    }, localUrl);
                });
                
                queryClient.invalidateQueries({ queryKey: ['files'] });
            }
        } catch (e) {
            if (!cancelledRef.current.has(item.id)) {
                const errMsg = String(e);
                if (errMsg.includes('Transfer cancelled')) {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'cancelled' } : i));
                } else {
                    setUploadQueue(q => q.map(i => i.id === item.id ? { ...i, status: 'error', error: errMsg } : i));
                    toast.error(`Upload failed for ${item.path.split('/').pop()}: ${e}`);
                }
            } else {
                cancelledRef.current.delete(item.id);
            }
        } finally {
            setProcessing(false);
        }
    };

    const handleManualUpload = async () => {
        try {
            const selected = await open({ multiple: true, directory: false });
            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected];
                const newItems: QueueItem[] = [];
                
                for (const path of paths) {
                    try {
                        const fileStat = await stat(path);
                        const fileName = path.split(/[\\/]/).pop() || '';
                        
                        // Deduplication Check
                        const isDuplicate = currentFiles.some(f => f.name === fileName && f.size === fileStat.size);
                        if (isDuplicate) {
                            toast.info(`Skipped "${fileName}" (Exact duplicate exists)`);
                            continue;
                        }
                        
                        newItems.push({
                            id: Math.random().toString(36).substr(2, 9),
                            path,
                            folderId: activeFolderId,
                            status: 'pending'
                        });
                    } catch (e) {
                        toast.error(`Failed to read file ${path}: ${e}`);
                    }
                }
                
                if (newItems.length > 0) {
                    setUploadQueue(prev => [...prev, ...newItems]);
                    toast.info(`Queued ${newItems.length} files for upload`);
                }
            }
        } catch {
            toast.error("Failed to open file dialog");
        }
    };

    const handleManualFolderUpload = async () => {
        try {
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === 'string') {
                toast.info("Scanning folder...");
                const files: {uri: string, name: string, size: number}[] = await invoke('cmd_scan_folder', { uri: selected });
                if (files.length === 0) {
                    toast.error("Folder is empty or could not be read.");
                    return;
                }
                
                const newItems: QueueItem[] = [];
                for (const f of files) {
                    const fileName = f.name.split('/').pop() || f.name;
                    const isDuplicate = currentFiles.some(cf => cf.name === fileName && cf.size === f.size);
                    if (isDuplicate) {
                        continue;
                    }
                    newItems.push({
                        id: Math.random().toString(36).substr(2, 9),
                        path: f.uri,
                        folderId: activeFolderId,
                        status: 'pending'
                    });
                }
                
                if (newItems.length > 0) {
                    setUploadQueue(prev => [...prev, ...newItems]);
                    toast.info(`Queued ${newItems.length} files from folder for upload`);
                    if (newItems.length < files.length) {
                        toast.info(`Skipped ${files.length - newItems.length} duplicates`);
                    }
                } else {
                    toast.info("All files skipped (exact duplicates exist)");
                }
            }
        } catch (e) {
            toast.error(`Failed to scan folder: ${e}`);
        }
    };

    const cancelAll = () => {
        setUploadQueue(q => {
            const uploading = q.find(i => i.status === 'uploading');
            if (uploading) {
                cancelledRef.current.add(uploading.id);
                invoke('cmd_cancel_transfer', { transferId: uploading.id }).catch(() => {});
            }
            return q
                .filter(i => i.status !== 'pending')
                .map(i => i.status === 'uploading' ? { ...i, status: 'cancelled' as const } : i);
        });
        toast.info('All uploads cancelled');
    };

    const cancelItem = (id: string) => {
        setUploadQueue(q => {
            const item = q.find(i => i.id === id);
            if (item?.status === 'uploading') {
                cancelledRef.current.add(id);
                invoke('cmd_cancel_transfer', { transferId: id }).catch(() => {});
                return q.map(i => i.id === id ? { ...i, status: 'cancelled' as const } : i);
            }
            // Remove pending items directly
            if (item?.status === 'pending') {
                return q.filter(i => i.id !== id);
            }
            return q;
        });
    };

    const retryItem = (id: string) => {
        setUploadQueue(q => q.map(i =>
            i.id === id && (i.status === 'error' || i.status === 'cancelled')
                ? { ...i, status: 'pending' as const, error: undefined, progress: undefined, uploadedBytes: undefined, totalBytes: undefined, speedBytesPerSec: undefined }
                : i
        ));
    };

    const { isDragging } = useFileDrop();

    return {
        uploadQueue,
        setUploadQueue,
        handleManualUpload,
        handleManualFolderUpload,
        cancelAll,
        cancelItem,
        retryItem,
        isDragging
    };
}
