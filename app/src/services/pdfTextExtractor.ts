import * as pdfjsLib from 'pdfjs-dist';

// Setting up the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Extracts native text from a PDF file.
 * Useful for indexing PDF documents into the SQLite FTS5 database.
 * 
 * @param pdfUrl The URL or Blob URL of the PDF
 * @returns The concatenated text content of the PDF
 */
export const extractTextFromPdf = async (pdfUrl: string): Promise<string> => {
    try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        
        let fullText = "";
        
        // Iterate through each page
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Extract the strings from the text items
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
                
            fullText += pageText + "\n";
        }
        
        return fullText;
    } catch (e) {
        console.error("PDF Text Extraction failed:", e);
        return "";
    }
};
