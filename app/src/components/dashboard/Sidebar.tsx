import { useState, useEffect } from 'react';
import { HardDrive, Folder, Plus, RefreshCw, LogOut } from 'lucide-react';

import { SidebarItem } from './SidebarItem';
import { BandwidthWidget } from './BandwidthWidget';
import { invoke } from '@tauri-apps/api/core';
import { TelegramFolder, BandwidthStats, TelegramAccount } from '../../types';
import { Menu, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { Trash2 } from 'lucide-react';

interface SidebarProps {
    folders: TelegramFolder[];
    unlockedVaults: Set<number>;
    handleUnlockVault: (folderId: number, password: string) => Promise<boolean>;
    handleLockVault: (folderId: number) => Promise<void>;
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onCreate: (name: string, password?: string) => Promise<void>;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: (silent?: boolean) => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
    accounts: TelegramAccount[];
    activeAccountId: string | null;
    onSwitchAccount: (id: string) => void;
    onAddAccount: () => void;
    onRemoveAccount: (id: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

export function Sidebar({
    folders, unlockedVaults, handleUnlockVault, handleLockVault, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate,
    isSyncing, isConnected, onSync, onLogout, bandwidth,
    accounts, activeAccountId, onSwitchAccount, onAddAccount, onRemoveAccount,
    isOpen, onClose
}: SidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderPassword, setNewFolderPassword] = useState('');
    const [isVault, setIsVault] = useState(false);
    const [unlockPromptId, setUnlockPromptId] = useState<number | null>(null);
    const [unlockPassword, setUnlockPassword] = useState('');
    const [totalStorage, setTotalStorage] = useState<number | null>(null);
    const [isCalculatingStorage, setIsCalculatingStorage] = useState(false);

    const fetchStorage = () => {
        if (!isConnected) return;
        setIsCalculatingStorage(true);
        invoke<number>('cmd_get_total_storage')
            .then(setTotalStorage)
            .catch(console.error)
            .finally(() => setIsCalculatingStorage(false));
    };

    useEffect(() => {
        if (isConnected) {
            fetchStorage();
        } else {
            setTotalStorage(null);
            setIsCalculatingStorage(false);
        }
    }, [isConnected]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    };

    const submitCreate = async () => {
        if (!newFolderName.trim()) return;
        try {
            await onCreate(newFolderName, isVault ? newFolderPassword : undefined);
            setNewFolderName("");
            setNewFolderPassword("");
            setIsVault(false);
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    }

    return (
        <>
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-40 md:hidden animate-fade-overlay"
                    onClick={onClose}
                />
            )}
            
            <aside className={`
                fixed inset-y-0 left-0 z-50 w-72 bg-telegram-surface border-r border-telegram-border flex flex-col shrink-0
                md:relative md:translate-x-0 pt-8 md:pt-0
                ${isOpen ? 'animate-slide-in-left translate-x-0' : '-translate-x-full md:translate-x-0'}
            `} onClick={e => e.stopPropagation()}>
                <div className="p-4 flex items-center justify-between border-b border-telegram-border">
                <div className="flex items-center gap-2">
                    <img src="/logo.png" className="w-8 h-8 drop-shadow-lg" alt="Logo" />
                    <span className="font-bold text-lg text-telegram-text tracking-tight">Telegram Drive</span>
                </div>
            </div>
            
            <div className="px-3 py-3 border-b border-telegram-border relative z-10">
                <Menu as="div" className="relative inline-block text-left w-full">
                    <div>
                        <Menu.Button className="inline-flex w-full justify-between items-center rounded-md bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75 border border-telegram-border">
                            <div className="flex flex-col items-start min-w-0">
                                <span className="truncate font-semibold">{accounts.find(a => a.id === activeAccountId)?.first_name || accounts.find(a => a.id === activeAccountId)?.phone || 'Account'}</span>
                                <span className="text-xs text-gray-400 truncate">{accounts.find(a => a.id === activeAccountId)?.phone || ''}</span>
                            </div>
                            <RefreshCw className="w-3 h-3 opacity-50 ml-2 shrink-0" />
                        </Menu.Button>
                    </div>
                    <Transition
                        as={Fragment}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                    >
                        <Menu.Items className="absolute right-0 mt-2 w-full origin-top-right divide-y divide-telegram-border rounded-md bg-telegram-surface shadow-lg ring-1 ring-black/5 focus:outline-none border border-telegram-border overflow-hidden">
                            <div className="p-1">
                                {accounts.map((account) => (
                                    <Menu.Item key={account.id}>
                                        {({ active }) => (
                                            <div className={`group flex w-full items-center justify-between rounded-md px-2 py-1 ${active ? 'bg-telegram-hover text-white' : 'text-gray-300'}`}>
                                                <button
                                                    onClick={() => onSwitchAccount(account.id)}
                                                    className={`flex-1 text-left min-w-0 ${account.id === activeAccountId ? 'font-bold' : ''}`}
                                                >
                                                    <div className="text-sm truncate">{account.first_name || account.phone}</div>
                                                    {account.first_name && <div className="text-xs text-gray-500 truncate">{account.phone}</div>}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onRemoveAccount(account.id); }}
                                                    className="p-1 text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-white/10"
                                                    title="Remove Account"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </Menu.Item>
                                ))}
                            </div>
                            <div className="p-1">
                                <Menu.Item>
                                    {({ active }) => (
                                        <button
                                            onClick={onAddAccount}
                                            className={`${
                                                active ? 'bg-telegram-hover text-white' : 'text-gray-300'
                                            } group flex w-full items-center rounded-md px-2 py-2 text-sm text-blue-400`}
                                        >
                                            <Plus className="w-4 h-4 mr-2" />
                                            Add Account
                                        </button>
                                    )}
                                </Menu.Item>
                            </div>
                        </Menu.Items>
                    </Transition>
                </Menu>
            </div>

            {/* Scrollable folder list */}
            <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto min-h-0">
                <SidebarItem
                    icon={HardDrive}
                    label="Saved Messages"
                    active={activeFolderId === null}
                    onClick={() => setActiveFolderId(null)}
                    onDrop={(e: React.DragEvent) => onDrop(e, null)}
                    folderId={null}
                />
                {folders.map(folder => {
                    const isVaultFolder = folder.name.includes('🔒');
                    const isUnlocked = unlockedVaults.has(folder.id);
                    const isPrompting = unlockPromptId === folder.id;

                    return (
                        <div key={folder.id} className="flex flex-col">
                            <SidebarItem
                                icon={Folder}
                                label={folder.name}
                                active={activeFolderId === folder.id}
                                onClick={() => {
                                    if (isVaultFolder && !isUnlocked) {
                                        if (isPrompting) {
                                            setUnlockPromptId(null);
                                        } else {
                                            setUnlockPromptId(folder.id);
                                            setUnlockPassword('');
                                        }
                                    } else {
                                        setActiveFolderId(folder.id);
                                    }
                                }}
                                onDrop={(e: React.DragEvent) => onDrop(e, folder.id)}
                                onDelete={() => onDelete(folder.id, folder.name)}
                                folderId={folder.id}
                            />
                            {isVaultFolder && isUnlocked && activeFolderId === folder.id && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleLockVault(folder.id); }}
                                    className="ml-8 mt-1 text-xs text-red-400 hover:text-red-300 flex items-center gap-1 w-fit"
                                >
                                    Lock Vault
                                </button>
                            )}
                            {isPrompting && (
                                <div className="mt-1 ml-4 pl-3 py-1.5 border-l-2 border-telegram-border/50 animate-fade-in flex flex-col gap-2">
                                    <input
                                        autoFocus
                                        type="password"
                                        className="w-full bg-black/20 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                                        placeholder="Vault Password"
                                        value={unlockPassword}
                                        onChange={e => setUnlockPassword(e.target.value)}
                                        onKeyDown={async (e) => {
                                            if (e.key === 'Enter' && unlockPassword) {
                                                const success = await handleUnlockVault(folder.id, unlockPassword);
                                                if (success) {
                                                    setUnlockPromptId(null);
                                                    setUnlockPassword('');
                                                    setActiveFolderId(folder.id);
                                                }
                                            }
                                        }}
                                    />
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => { setUnlockPromptId(null); setUnlockPassword(''); }}
                                            className="px-2 py-1 text-xs text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button 
                                            onClick={async () => {
                                                if (!unlockPassword) return;
                                                const success = await handleUnlockVault(folder.id, unlockPassword);
                                                if (success) {
                                                    setUnlockPromptId(null);
                                                    setUnlockPassword('');
                                                    setActiveFolderId(folder.id);
                                                }
                                            }}
                                            className="px-2 py-1 text-xs text-telegram-primary hover:bg-telegram-primary/10 rounded transition-colors font-medium"
                                        >
                                            Unlock
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Sticky Create Folder section — always visible above the footer */}
            <div className="px-2 pb-2 border-b border-telegram-border">
                {showNewFolderInput ? (
                    <div className="px-3 py-2 bg-white/5 rounded-lg border border-telegram-border space-y-2">
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-black/20 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            placeholder="Folder Name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCreate()}
                        />
                        <label className="flex items-center gap-2 text-xs text-telegram-subtext cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={isVault} 
                                onChange={e => setIsVault(e.target.checked)} 
                                className="rounded border-telegram-border bg-black/20 text-telegram-primary focus:ring-telegram-primary"
                            />
                            <span>Encrypted Vault</span>
                        </label>
                        {isVault && (
                            <input
                                type="password"
                                className="w-full bg-black/20 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                                placeholder="Vault Password"
                                value={newFolderPassword}
                                onChange={e => setNewFolderPassword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && submitCreate()}
                            />
                        )}
                        <div className="flex gap-2 pt-1">
                            <button 
                                onClick={() => {
                                    setShowNewFolderInput(false);
                                    setNewFolderName("");
                                    setNewFolderPassword("");
                                    setIsVault(false);
                                }}
                                className="flex-1 px-2 py-1.5 text-xs text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={submitCreate}
                                className="flex-1 px-2 py-1.5 text-xs text-telegram-primary hover:bg-telegram-primary/10 rounded transition-colors font-medium"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-telegram-subtext hover:bg-telegram-hover hover:text-telegram-text transition-colors border border-dashed border-telegram-border"
                    >
                        <Plus className="w-4 h-4" />
                        Create Folder
                    </button>
                )}
            </div>

            <div className="p-4 border-t border-telegram-border">
                <div className="flex items-center gap-2 text-telegram-subtext text-xs mb-3">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span>{isConnected ? 'Connected to Telegram' : 'Disconnected from Telegram'}</span>
                </div>

                {(totalStorage !== null || isCalculatingStorage) && (
                    <div className="mb-4 bg-white/5 rounded-lg p-3 border border-telegram-border">
                        <div className="flex items-center justify-between text-xs text-telegram-subtext mb-1">
                            <span>Total Storage Used</span>
                            <button onClick={fetchStorage} disabled={isCalculatingStorage} className="hover:text-white transition-colors" title="Refresh storage size">
                                <RefreshCw className={`w-3 h-3 ${isCalculatingStorage ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                        <div className="text-sm font-bold text-white">
                            {isCalculatingStorage ? (
                                <span className="flex items-center gap-2">
                                    <RefreshCw className="w-3 h-3 animate-spin" /> Calculating...
                                </span>
                            ) : (
                                formatSize(totalStorage!)
                            )}
                        </div>
                    </div>
                )}

                <div className="flex gap-2">
                    <button
                        onClick={() => onSync(false)}
                        disabled={isSyncing}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-500 hover:text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Scan for existing folders"
                    >
                        <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing...' : 'Sync'}
                    </button>
                    <button
                        onClick={onLogout}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Sign Out"
                    >
                        <LogOut className="w-3 h-3" />
                        Logout
                    </button>
                </div>

                {bandwidth && <BandwidthWidget bandwidth={bandwidth} />}
            </div>

        </aside>
        </>
    );
}
