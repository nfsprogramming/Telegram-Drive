import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useConfirm } from '../context/ConfirmContext';
import { TelegramFolder, TelegramAccount } from '../types';
import { useNetworkStatus } from './useNetworkStatus';

export function useTelegramConnection(onLogoutParent: () => void) {
    const queryClient = useQueryClient();
    const { confirm } = useConfirm();

    const [accounts, setAccounts] = useState<TelegramAccount[]>([]);
    const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

    const [folders, setFolders] = useState<TelegramFolder[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
    const [store, setStore] = useState<Store | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isConnected, setIsConnected] = useState(true);
    const [isSessionReady, setIsSessionReady] = useState(false);
    const [unlockedVaults, setUnlockedVaults] = useState<Set<number>>(new Set());


    const networkIsOnline = useNetworkStatus();


    useEffect(() => {
        const initStore = async () => {
            try {
                let _store = await Store.load('config.json');
                const checkId = await _store.get<string>('api_id');
                if (!checkId) {
                    _store = await Store.load('settings.json');
                }
                setStore(_store);

                const savedAccounts = await _store.get<TelegramAccount[]>('accounts') || [];
                setAccounts(savedAccounts);
                
                let activeId = await _store.get<string>('active_account_id');
                if (!activeId && savedAccounts.length > 0) {
                    activeId = savedAccounts[0].id;
                }
                
                if (activeId) {
                    setActiveAccountId(activeId);
                    
                    const savedFolders = await _store.get<TelegramFolder[]>(`${activeId}_folders`);
                    if (savedFolders) setFolders(savedFolders);

                    const savedActiveFolderId = await _store.get<number | null>(`${activeId}_activeFolderId`);
                    if (savedActiveFolderId !== undefined) setActiveFolderId(savedActiveFolderId);
                    
                    const activeAccount = savedAccounts.find(a => a.id === activeId);
                    if (activeAccount) {
                        const apiIdStr = await _store.get<string>('api_id');
                        if (apiIdStr) {
                            const doConnect = async () => {
                                const apiId = parseInt(apiIdStr as string);
                                await invoke('cmd_connect', { apiId, sessionName: activeAccount.session_name });

                                // Verify the actual Telegram user matches and sync the phone number
                                try {
                                    const me = await invoke<{ id: number; phone: string; first_name: string }>('cmd_get_me');
                                    console.log(`[AccountVerify] session=${activeAccount.session_name} expected_phone=${activeAccount.phone} actual_phone=${me.phone}`);
                                    // Sync phone and first_name if they differ
                                    if ((me.phone && me.phone !== activeAccount.phone) || (me.first_name && me.first_name !== activeAccount.first_name)) {
                                        const updatedAccounts = savedAccounts.map(a =>
                                            a.id === activeId ? { ...a, phone: me.phone, first_name: me.first_name } : a
                                        );
                                        await _store.set('accounts', updatedAccounts);
                                        await _store.save();
                                        setAccounts(updatedAccounts);
                                    }
                                } catch (e) {
                                    console.warn('[AccountVerify] cmd_get_me failed:', e);
                                }
                            };

                            try {
                                await doConnect();
                                setIsConnected(true);
                                setIsSessionReady(true);
                                queryClient.invalidateQueries({ queryKey: ['files'] });
                                // Auto-sync folders silently in the background
                                setTimeout(() => handleSyncFolders(true), 1000);
                            } catch {
                                // Retry loop: keep asking until the user succeeds or cancels
                                let connected = false;
                                while (!connected) {
                                    const shouldRetry = await confirm({
                                        title: "Connection Failed",
                                        message: "Failed to connect to Telegram. Would you like to retry?",
                                        confirmText: "Retry",
                                        variant: 'danger'
                                    });
                                    if (!shouldRetry) {
                                        onLogoutParent();
                                        return;
                                    }
                                    try {
                                        await doConnect();
                                        setIsConnected(true);
                                        setIsSessionReady(true);
                                        queryClient.invalidateQueries({ queryKey: ['files'] });
                                        connected = true;
                                        // Auto-sync folders silently in the background
                                        setTimeout(() => handleSyncFolders(true), 1000);
                                    } catch {
                                        // Loop will show the confirm dialog again
                                    }
                                }
                            }
                        } else {
                            onLogoutParent();
                        }
                    } else {
                        onLogoutParent();
                    }
                } else {
                    onLogoutParent();
                }

            } catch {
                // store not available
            }
        };
        initStore();
    }, [queryClient, onLogoutParent, confirm]);


    useEffect(() => {
        setIsConnected(networkIsOnline);
    }, [networkIsOnline]);


    const isNetworkError = (error: string): boolean => {
        const keywords = ['timeout', 'connection', 'network', 'socket', 'disconnected', 'EOF', 'ECONNREFUSED', 'overflow'];
        return keywords.some(k => error.toLowerCase().includes(k.toLowerCase()));
    };

    const forceLogout = async () => {
        setIsConnected(false);
        try {
            await invoke('cmd_clean_cache').catch(() => { });
        } catch {
            // best effort cleanup
        }
        toast.error("Connection lost. Please log in again.");
        onLogoutParent();
    };


    const handleLogout = async () => {
        if (!await confirm({ title: "Sign Out", message: "Are you sure you want to sign out this account? This will disconnect your active session.", confirmText: "Sign Out", variant: 'danger' })) return;

        try {
            await invoke('cmd_logout');
            await invoke('cmd_clean_cache');
            if (store && activeAccountId) {
                const updatedAccounts = accounts.filter(a => a.id !== activeAccountId);
                await store.set('accounts', updatedAccounts);
                await store.delete(`${activeAccountId}_folders`);
                await store.delete(`${activeAccountId}_activeFolderId`);
                
                if (updatedAccounts.length > 0) {
                    await store.set('active_account_id', updatedAccounts[0].id);
                    // Force reload to switch to the next account
                    window.location.reload();
                } else {
                    await store.delete('active_account_id');
                    await store.delete('api_id');
                    await store.delete('api_hash');
                    await store.save();
                    onLogoutParent();
                }
            }
        } catch {
            toast.error("Error signing out");
            onLogoutParent();
        }
    };

    const handleSyncFolders = async (silent: boolean = false) => {
        if (!store) return;
        if (!silent) setIsSyncing(true);
        try {
            const foundFolders = await invoke<TelegramFolder[]>('cmd_scan_folders');
            const currentActiveId = await store.get<string>('active_account_id');
            setFolders(prev => {
                const merged = [...prev];
                let added = 0;
                for (const f of foundFolders) {
                    if (!merged.find(existing => existing.id === f.id)) {
                        merged.push(f);
                        added++;
                    }
                }
                if (added > 0) {
                    if (currentActiveId) {
                        store.set(`${currentActiveId}_folders`, merged).then(() => store.save());
                    }
                    if (!silent) toast.success(`Scan complete. Found ${added} new folders.`);
                } else {
                    if (!silent) toast.info("Scan complete. No new folders found.");
                }
                return merged;
            });
        } catch {
            if (!silent) toast.error("Sync failed");
        } finally {
            if (!silent) setIsSyncing(false);
        }
    };
    const handleCreateFolder = async (name: string, password?: string) => {
        if (!store) return;
        try {
            const finalName = password ? `🔒 ${name}` : name;
            const newFolder = await invoke<TelegramFolder>('cmd_create_folder', { name: finalName });
            
            if (password) {
                await invoke('cmd_unlock_vault', { folderId: newFolder.id, password });
                setUnlockedVaults(prev => new Set(prev).add(newFolder.id));
            }

            const updated = [...folders, newFolder];
            setFolders(updated);
            if (activeAccountId) await store.set(`${activeAccountId}_folders`, updated);
            await store.save();
            toast.success(`Folder "${finalName}" created.`);
        } catch (e) {
            toast.error("Failed to create folder: " + e);
            throw e;
        }
    };
    const handleFolderDelete = async (folderId: number, folderName: string) => {
        if (!await confirm({
            title: "Delete Folder",
            message: `Are you sure you want to delete "${folderName}"?\nThis will delete the channel on Telegram.`,
            confirmText: "Delete",
            variant: 'danger'
        })) return;

        try {
            await invoke('cmd_delete_folder', { folderId });
            const updated = folders.filter(f => f.id !== folderId);
            setFolders(updated);
            if (store && activeAccountId) {
                await store.set(`${activeAccountId}_folders`, updated);
                await store.save();
            }
            if (activeFolderId === folderId) setActiveFolderId(null);
            toast.success(`Folder "${folderName}" deleted.`);
        } catch (e: unknown) {
            const errStr = String(e);
            if (errStr.includes("not found")) {
                if (await confirm({
                    title: "Folder Not Found",
                    message: `Folder "${folderName}" not found on Telegram (it may have been deleted externally).\nRemove from this app?`,
                    confirmText: "Remove",
                    variant: 'info'
                })) {
                    const updated = folders.filter(f => f.id !== folderId);
                    setFolders(updated);
                    if (store && activeAccountId) {
                        await store.set(`${activeAccountId}_folders`, updated);
                        await store.save();
                    }
                    if (activeFolderId === folderId) setActiveFolderId(null);
                }
            } else {
                toast.error(`Failed to delete folder: ${e}`);
            }
        }
    };


    const handleSetActiveFolderId = async (id: number | null) => {
        setActiveFolderId(id);
        if (store && activeAccountId) {
            await store.set(`${activeAccountId}_activeFolderId`, id);
            await store.save();
        }
    };
    
    const handleSwitchAccount = async (accountId: string) => {
        if (!store) return;
        // 1. Save the new active account BEFORE reload
        await store.set('active_account_id', accountId);
        await store.save();
        // 2. Wipe the entire React Query cache so no stale files are shown
        queryClient.clear();
        // 3. Tell backend to drop its current client/peer-cache immediately
        try { await invoke('cmd_clear_peer_cache'); } catch { /* best effort */ }
        // 4. Reload the app
        window.location.reload();
    };

    const handleUnlockVault = async (folderId: number, password: string): Promise<boolean> => {
        try {
            await invoke('cmd_unlock_vault', { folderId, password });
            setUnlockedVaults(prev => new Set(prev).add(folderId));
            return true;
        } catch (e) {
            toast.error("Failed to unlock vault: " + e);
            return false;
        }
    };

    const handleLockVault = async (folderId: number) => {
        try {
            await invoke('cmd_lock_vault', { folderId });
            setUnlockedVaults(prev => {
                const s = new Set(prev);
                s.delete(folderId);
                return s;
            });
            if (activeFolderId === folderId) setActiveFolderId(null);
        } catch (e) {
            toast.error("Failed to lock vault: " + e);
        }
    };

    return {
        store,
        accounts,
        activeAccountId,
        handleSwitchAccount,
        folders,
        activeFolderId,
        setActiveFolderId: handleSetActiveFolderId,
        isSyncing,
        isConnected,
        isSessionReady,
        unlockedVaults,
        handleUnlockVault,
        handleLockVault,
        handleLogout,
        handleSyncFolders,
        handleCreateFolder,
        handleFolderDelete,
        isNetworkError,
        forceLogout
    };
}
