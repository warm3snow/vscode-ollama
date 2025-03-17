interface CacheItem<T> {
    data: T;
    timestamp: number;
}

export class CacheService<T> {
    private cache: Map<string, CacheItem<T>> = new Map();
    private readonly ttl: number; // Time to live in milliseconds

    constructor(ttlMinutes: number = 60) {
        this.ttl = ttlMinutes * 60 * 1000;
    }

    set(key: string, value: T): void {
        this.cache.set(key, {
            data: value,
            timestamp: Date.now()
        });
    }

    get(key: string): T | null {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        return item.data;
    }

    clear(): void {
        this.cache.clear();
    }
} 