import { X, File, Clock, HardDrive, Type } from 'lucide-react';
import { TelegramFile } from '../../types';
import { formatBytes } from '../../utils';

interface FileDetailsModalProps {
    file: TelegramFile;
    onClose: () => void;
}

export function FileDetailsModal({ file, onClose }: FileDetailsModalProps) {
    return (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-telegram-surface border border-telegram-border rounded-xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-telegram-text">File Details</h3>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-telegram-subtext hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex flex-col gap-5">
                    <div className="flex items-start gap-4 p-3 bg-white/5 rounded-lg border border-white/5">
                        <div className="p-3 bg-telegram-primary/20 rounded-lg shrink-0">
                            <File className="w-6 h-6 text-telegram-primary" />
                        </div>
                        <div className="overflow-hidden">
                            <div className="text-xs text-telegram-subtext mb-1 uppercase tracking-wider font-semibold">Name</div>
                            <div className="text-sm text-telegram-text font-medium break-words leading-tight">{file.name}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                            <HardDrive className="w-5 h-5 text-telegram-subtext" />
                            <div>
                                <div className="text-[10px] text-telegram-subtext uppercase font-semibold">Size</div>
                                <div className="text-sm text-telegram-text">{file.sizeStr || formatBytes(file.size ?? 0)}</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                            <Type className="w-5 h-5 text-telegram-subtext" />
                            <div>
                                <div className="text-[10px] text-telegram-subtext uppercase font-semibold">Type</div>
                                <div className="text-sm text-telegram-text">{file.type === 'folder' ? 'Folder' : file.name.split('.').pop()?.toUpperCase() || 'FILE'}</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                        <Clock className="w-5 h-5 text-telegram-subtext shrink-0" />
                        <div>
                            <div className="text-[10px] text-telegram-subtext uppercase font-semibold">Date Uploaded</div>
                            <div className="text-sm text-telegram-text">{file.created_at ? new Date(file.created_at).toLocaleString() : 'Unknown'}</div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-telegram-primary hover:bg-telegram-primary/90 text-white font-medium rounded-lg transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
