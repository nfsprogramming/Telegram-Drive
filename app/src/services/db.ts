import initSqlJs, { Database } from 'sql.js';
import { BaseDirectory, readFile, writeFile } from '@tauri-apps/plugin-fs';

let dbInstance: Database | null = null;
const DB_FILENAME = 'search_index.sqlite';

export const getDb = async (): Promise<Database> => {
    if (dbInstance) return dbInstance;
    
    // Initialize sql.js (we must point it to the wasm file)
    const SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`
    });
    
    // Try to load existing database from AppData
    try {
        const data = await readFile(DB_FILENAME, { baseDir: BaseDirectory.AppData });
        dbInstance = new SQL.Database(data);
    } catch {
        // If it doesn't exist or fails, create a new one
        dbInstance = new SQL.Database();
        await initSchema(dbInstance);
    }
    
    return dbInstance;
};

const initSchema = async (db: Database) => {
    db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search_fts USING fts5(
            id UNINDEXED,
            folder_id UNINDEXED,
            name,
            content
        );
    `);
    await saveDb(db);
};

// Save the database to disk via Tauri
const saveDb = async (db: Database) => {
    const data = db.export();
    await writeFile(DB_FILENAME, data, { baseDir: BaseDirectory.AppData });
};

export const indexFile = async (id: number, folderId: number | null, name: string, content: string) => {
    const db = await getDb();
    db.run(`DELETE FROM file_search_fts WHERE id = ?`, [id]);
    db.run(
        `INSERT INTO file_search_fts (id, folder_id, name, content) VALUES (?, ?, ?, ?)`,
        [id, folderId ?? -1, name, content]
    );
    await saveDb(db);
};

export const searchFiles = async (query: string): Promise<{ id: number, folder_id: number, name: string, snippet: string }[]> => {
    const db = await getDb();
    
    const stmt = db.prepare(`
        SELECT id, folder_id, name, snippet(file_search_fts, 3, '<b>', '</b>', '...', 10) as snippet 
        FROM file_search_fts 
        WHERE file_search_fts MATCH ? 
        ORDER BY rank 
        LIMIT 50
    `);
    
    stmt.bind([query]);
    
    const results: { id: number, folder_id: number, name: string, snippet: string }[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: Number(row.id),
            folder_id: Number(row.folder_id),
            name: String(row.name),
            snippet: String(row.snippet)
        });
    }
    stmt.free();
    
    return results;
};

export const removeFileFromIndex = async (id: number) => {
    const db = await getDb();
    db.run(`DELETE FROM file_search_fts WHERE id = ?`, [id]);
    await saveDb(db);
};
