import { useEffect, useRef, useId } from 'react';

const backStack: { id: string, onBack: () => void }[] = [];
let ignoreNextPopState = false;

/**
 * Hook to handle Android hardware back button (via browser history)
 * Pushes state to a global stack so only the top-most component handles the back event.
 * @param active Whether the state is currently active
 * @param onBack Callback to run when the back button is pressed
 */
export function useHardwareBack(active: boolean, onBack: () => void) {
    const id = useId();
    const isPushed = useRef(false);

    useEffect(() => {
        if (active && !isPushed.current) {
            backStack.push({ id, onBack });
            window.history.pushState({ isHardwareBackHook: true, id }, '', window.location.pathname + window.location.search + '#dialog');
            isPushed.current = true;
        } else if (!active && isPushed.current) {
            // Remove from stack
            const index = backStack.findIndex(item => item.id === id);
            if (index !== -1) {
                backStack.splice(index, 1);
            }
            if (window.history.state?.isHardwareBackHook && window.history.state?.id === id) {
                ignoreNextPopState = true;
                window.history.back();
            }
            isPushed.current = false;
        }
    }, [active, id, onBack]);

    useEffect(() => {
        const handlePopState = () => {
            if (ignoreNextPopState) {
                ignoreNextPopState = false;
                return;
            }
            if (backStack.length > 0) {
                const top = backStack[backStack.length - 1];
                if (top.id === id) {
                    isPushed.current = false;
                    backStack.pop();
                    top.onBack();
                }
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [id]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            const index = backStack.findIndex(item => item.id === id);
            if (index !== -1) {
                backStack.splice(index, 1);
            }
        };
    }, [id]);
}

