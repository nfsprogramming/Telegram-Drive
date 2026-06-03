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
    activeFolderId: number | null;
    setActiveFolderId: (id: number | null) => void;
    onDrop: (e: React.DragEvent, folderId: number | null) => void;
    onDelete: (id: number, name: string) => void;
    onCreate: (name: string) => Promise<void>;
    isSyncing: boolean;
    isConnected: boolean;
    onSync: () => void;
    onLogout: () => void;
    bandwidth: BandwidthStats | null;
    accounts: TelegramAccount[];
    activeAccountId: string | null;
    onSwitchAccount: (id: string) => void;
    onAddAccount: () => void;
    onRemoveAccount: (id: string) => void;
}

export function Sidebar({
    folders, activeFolderId, setActiveFolderId, onDrop, onDelete, onCreate,
    isSyncing, isConnected, onSync, onLogout, bandwidth,
    accounts, activeAccountId, onSwitchAccount, onAddAccount, onRemoveAccount
}: SidebarProps) {
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
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
            await onCreate(newFolderName);
            setNewFolderName("");
            setShowNewFolderInput(false);
        } catch {
            // handled by parent
        }
    }

    return (
        <aside className="w-64 bg-telegram-surface border-r border-telegram-border flex flex-col" onClick={e => e.stopPropagation()}>
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
                {folders.map(folder => (
                    <SidebarItem
                        key={folder.id}
                        icon={Folder}
                        label={folder.name}
                        active={activeFolderId === folder.id}
                        onClick={() => setActiveFolderId(folder.id)}
                        onDrop={(e: React.DragEvent) => onDrop(e, folder.id)}
                        onDelete={() => onDelete(folder.id, folder.name)}
                        folderId={folder.id}
                    />
                ))}
            </nav>

            {/* Sticky Create Folder section — always visible above the footer */}
            <div className="px-2 pb-2 border-b border-telegram-border">
                {showNewFolderInput ? (
                    <div className="px-3 py-2">
                        <input
                            autoFocus
                            type="text"
                            className="w-full bg-white/10 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-telegram-primary"
                            placeholder="Folder Name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submitCreate()}
                            onBlur={() => !newFolderName && setShowNewFolderInput(false)}
                        />
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
                        onClick={onSync}
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
    )
}
