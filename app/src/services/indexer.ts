import { indexFile } from './db';
import { extractTextFromImage } from './ocr';
import { extractTextFromPdf } from './pdfTextExtractor';

/**
 * Background indexer that takes a file URL (local path or streaming URL)
 * and attempts to extract text from it based on its mime type.
 * The extracted text is then inserted into the SQLite FTS5 database.
 */
export const runBackgroundIndexing = async (file: { id: number, folder_id: number | null, name: string, mime_type: string | null }, fileUrl: string) => {
    try {
        let extractedText = "";
        
        // 1. PDF Text Extraction
        if (file.mime_type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            console.log(`[Indexer] Starting PDF extraction for ${file.name}...`);
            extractedText = await extractTextFromPdf(fileUrl);
            console.log(`[Indexer] PDF extraction complete. Length: ${extractedText.length}`);
        }
        
        // 2. Image OCR Extraction
        else if (file.mime_type?.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp)$/i.test(file.name)) {
            console.log(`[Indexer] Starting Image OCR for ${file.name}...`);
            extractedText = await extractTextFromImage(fileUrl);
            console.log(`[Indexer] Image OCR complete. Length: ${extractedText.length}`);
        }
        
        // 3. Plain Text File
        else if (file.mime_type?.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name)) {
            console.log(`[Indexer] Reading plain text file ${file.name}...`);
            const response = await fetch(fileUrl);
            extractedText = await response.text();
        }
        
        // If we found text, insert it into the SQLite FTS5 database!
        if (extractedText && extractedText.trim().length > 0) {
            console.log(`[Indexer] Saving to FTS5 Database: ${file.name}`);
            await indexFile(file.id, file.folder_id, file.name, extractedText);
        } else {
            // Still index the file name even if no content
            await indexFile(file.id, file.folder_id, file.name, "");
        }
        
    } catch (e) {
        console.error(`[Indexer] Failed to index ${file.name}:`, e);
    }
};
