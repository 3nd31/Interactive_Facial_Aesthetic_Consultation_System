/**
 * StorageManager — IndexedDB storage for face models and surgery plans
 * Stores UV textures, mesh data, and surgery parameter history
 */

const DB_NAME = 'facevr-storage';
const DB_VERSION = 2;

export interface SavedPlan {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    uvTextureBlob: Blob | null;
    shapeParams: number[];
    surgeryParams: Record<string, number>;
    thumbnailBlob: Blob | null;
}

export class StorageManager {
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('plans')) {
                    const store = db.createObjectStore('plans', { keyPath: 'id' });
                    store.createIndex('updatedAt', 'updatedAt');
                }
                if (!db.objectStoreNames.contains('textures')) {
                    db.createObjectStore('textures', { keyPath: 'id' });
                }
            };

            req.onsuccess = () => {
                this.db = req.result;
                console.log('[Storage] IndexedDB ready');
                resolve();
            };

            req.onerror = () => reject(req.error);
        });
    }

    async savePlan(plan: SavedPlan): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('plans', 'readwrite');
            plan.updatedAt = Date.now();
            tx.objectStore('plans').put(plan);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async loadPlan(id: string): Promise<SavedPlan | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('plans', 'readonly');
            const req = tx.objectStore('plans').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async listPlans(): Promise<SavedPlan[]> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('plans', 'readonly');
            const store = tx.objectStore('plans');
            const idx = store.index('updatedAt');
            const req = idx.getAll();
            req.onsuccess = () => resolve((req.result || []).reverse());
            req.onerror = () => reject(req.error);
        });
    }

    async deletePlan(id: string): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('plans', 'readwrite');
            tx.objectStore('plans').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async clearAll(): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(['plans', 'textures'], 'readwrite');
            tx.objectStore('plans').clear();
            tx.objectStore('textures').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /** Save UV texture as Blob */
    async saveTexture(id: string, blob: Blob): Promise<void> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('textures', 'readwrite');
            tx.objectStore('textures').put({ id, blob, savedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async loadTexture(id: string): Promise<Blob | null> {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction('textures', 'readonly');
            const req = tx.objectStore('textures').get(id);
            req.onsuccess = () => resolve(req.result?.blob || null);
            req.onerror = () => reject(req.error);
        });
    }

    /** Get storage usage estimate */
    async getUsage(): Promise<{ used: number; quota: number }> {
        try {
            const est = await navigator.storage.estimate();
            return { used: est.usage || 0, quota: est.quota || 0 };
        } catch {
            return { used: 0, quota: 0 };
        }
    }
}
