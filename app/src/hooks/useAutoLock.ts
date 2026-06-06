import { useEffect, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useAutoLock(
    unlockedVaults: Set<number>,
    handleLockVault: (id: number) => Promise<void>
) {
    const lockAllVaults = useCallback(async () => {
        if (unlockedVaults.size === 0) return;
        
        for (const vaultId of unlockedVaults) {
            await handleLockVault(vaultId);
        }
    }, [unlockedVaults, handleLockVault]);

    // 1. Lock on Inactivity (5 minutes)
    useEffect(() => {
        if (unlockedVaults.size === 0) return;

        let timeout: NodeJS.Timeout;
        const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

        const resetTimer = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                lockAllVaults();
            }, TIMEOUT_MS);
        };

        window.addEventListener('mousemove', resetTimer);
        window.addEventListener('keydown', resetTimer);
        window.addEventListener('click', resetTimer);
        window.addEventListener('scroll', resetTimer);
        
        resetTimer();

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('mousemove', resetTimer);
            window.removeEventListener('keydown', resetTimer);
            window.removeEventListener('click', resetTimer);
            window.removeEventListener('scroll', resetTimer);
        };
    }, [unlockedVaults.size, lockAllVaults]);

    // 2. Lock when app is minimized or hidden
    useEffect(() => {
        if (unlockedVaults.size === 0) return;

        const appWindow = getCurrentWindow();
        
        // Listen to window resize events to detect minimization
        const unlistenResized = appWindow.onResized(async () => {
            const isMinimized = await appWindow.isMinimized();
            if (isMinimized) {
                lockAllVaults();
            }
        });

        // Listen to visibilitychange in case the OS hides the webview
        const handleVisibilityChange = () => {
            if (document.hidden) {
                lockAllVaults();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            unlistenResized.then(fn => fn()).catch(console.error);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [unlockedVaults.size, lockAllVaults]);
}
