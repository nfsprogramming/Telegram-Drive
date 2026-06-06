import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TelegramFile } from '../../types';

interface RenameModalProps {
    file: TelegramFile;
    onClose: () => void;
    onRename: (id: number, newName: string) => void;
}

export function RenameModal({ file, onClose, onRename }: RenameModalProps) {
    const [name, setName] = useState(file.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            // Select text without extension if possible
            const extIndex = file.name.lastIndexOf('.');
            if (extIndex > 0) {
                inputRef.current.setSelectionRange(0, extIndex);
            } else {
                inputRef.current.select();
            }
        }
    }, [file]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim() && name !== file.name) {
            onRename(file.id, name.trim());
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-telegram-surface border border-telegram-border rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-4 border-b border-telegram-border flex justify-between items-center bg-telegram-surface/50">
                    <h3 className="font-semibold text-telegram-text">Rename File</h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-telegram-subtext mb-2">
                            New Name
                        </label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-telegram-hover border border-telegram-border rounded-lg px-3 py-2 text-telegram-text focus:outline-none focus:border-telegram-primary transition-colors"
                            placeholder="Enter new name"
                        />
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-telegram-subtext hover:text-telegram-text hover:bg-telegram-hover rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || name === file.name}
                            className="px-4 py-2 text-sm font-medium bg-telegram-primary hover:bg-telegram-primary/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Rename
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
