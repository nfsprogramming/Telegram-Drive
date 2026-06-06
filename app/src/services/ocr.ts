import Tesseract from 'tesseract.js';


// Check if we are running on a mobile platform (Android/iOS)
// Tauri provides the platform information via the core API or we can check maxTouchPoints
const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export const extractTextFromImage = async (imageUrl: string): Promise<string> => {
    try {
        if (isMobile) {
            // Mobile: Call native ML Kit Plugin via Tauri Invoke
            // (We will implement this native plugin later)
            console.log("Using ML Kit for OCR on Mobile...");
            // For now, return empty or mock until native plugin is ready
            return ""; 
        } else {
            // Desktop: Use Tesseract.js (WebAssembly)
            console.log("Using Tesseract.js for OCR on Desktop...");
            
            // Tesseract.recognize automatically spins up a WebWorker, downloads the language model if needed,
            // and performs the OCR extraction entirely in the background thread.
            const result = await Tesseract.recognize(imageUrl, 'eng', {
                logger: m => console.log(m)
            });
            
            return result.data.text;
        }
    } catch (e) {
        console.error("OCR Extraction failed:", e);
        return "";
    }
};
