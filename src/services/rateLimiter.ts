export class RateLimiter {
    private timestamps: number[] = [];
    private readonly windowMs: number;
    readonly maxRequests: number;

    constructor(windowMs: number = 60000, maxRequests: number = 10) {
        if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
            throw new Error('maxRequests must be greater than 0.');
        }
        this.windowMs = windowMs;
        this.maxRequests = Math.max(1, Math.floor(maxRequests));
    }

    async checkLimit(): Promise<boolean> {
        const now = Date.now();
        this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
        
        if (this.timestamps.length >= this.maxRequests) {
            return false;
        }

        this.timestamps.push(now);
        return true;
    }

    async waitForAvailability(signal?: AbortSignal): Promise<void> {
        while (!(await this.checkLimit())) {
            if (signal?.aborted) {
                throw new Error('Rate limit wait cancelled.');
            }
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const cleanup = () => signal?.removeEventListener('abort', onAbort);
                const finish = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    resolve();
                };
                const onAbort = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    cleanup();
                    reject(new Error('Rate limit wait cancelled.'));
                };
                const timer = setTimeout(finish, 1000);
                signal?.addEventListener('abort', onAbort, { once: true });
            });
        }
    }
} 