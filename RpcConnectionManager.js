"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcConnectionManager = void 0;
exports.createRpcManagerFromEnv = createRpcManagerFromEnv;
const web3_js_1 = require("@solana/web3.js");
class RpcConnectionManager {
    constructor(config) {
        this.currentEndpointIndex = 0;
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.rateLimitBackoffUntil = 0;
        this.config = {
            commitment: 'confirmed',
            rateLimitRetryAttempts: 5,
            rateLimitBackoffMs: 1000,
            healthCheckInterval: 30000,
            requestQueueSize: 100,
            ...config,
        };
        // Sort endpoints by weight (highest first)
        this.endpoints = config.endpoints.sort((a, b) => b.weight - a.weight);
        // Initialize connections and stats
        this.connections = new Map();
        this.stats = new Map();
        this.endpoints.forEach((endpoint) => {
            const connectionConfig = {
                commitment: this.config.commitment,
                wsEndpoint: this.config.wsEndpoint,
                disableRetryOnRateLimit: false, // Let SDK handle retries too
                httpHeaders: this.getHttpHeaders(endpoint),
            };
            this.connections.set(endpoint.url, new web3_js_1.Connection(endpoint.url, connectionConfig));
            this.stats.set(endpoint.url, {
                requests: 0,
                errors: 0,
                rateLimitHits: 0,
                lastRateLimitTime: 0,
                lastSuccessTime: Date.now(),
                avgResponseTime: 0,
                isHealthy: true,
            });
        });
        console.log(`[RPC Manager] Initialized with ${this.endpoints.length} endpoints`);
        this.endpoints.forEach((ep, i) => {
            console.log(`  [${i + 1}] ${ep.type}: ${ep.url.substring(0, 50)}... (weight: ${ep.weight})`);
        });
        // Start health check monitoring
        this.startHealthMonitoring();
    }
    /**
     * Get HTTP headers for RPC endpoint (API keys, etc.)
     */
    getHttpHeaders(endpoint) {
        // Add custom headers for different providers if needed
        if (endpoint.type === 'helius' && endpoint.url.includes('api-key')) {
            return {
                'Content-Type': 'application/json',
            };
        }
        return undefined;
    }
    /**
     * Get the best available connection based on health and rate limits
     */
    getConnection() {
        const now = Date.now();
        // Check if we're in global rate limit backoff
        if (now < this.rateLimitBackoffUntil) {
            const waitTime = this.rateLimitBackoffUntil - now;
            console.warn(`[RPC Manager] In rate limit backoff for ${waitTime}ms`);
        }
        // Find the first healthy endpoint
        for (let i = 0; i < this.endpoints.length; i++) {
            const endpoint = this.endpoints[i];
            const stats = this.stats.get(endpoint.url);
            // Skip if recently rate limited (within last 5 seconds)
            if (now - stats.lastRateLimitTime < 5000) {
                continue;
            }
            // Skip if marked unhealthy
            if (!stats.isHealthy) {
                continue;
            }
            const connection = this.connections.get(endpoint.url);
            return connection;
        }
        // If all endpoints are rate limited or unhealthy, use the primary one anyway
        console.warn('[RPC Manager] All endpoints rate limited/unhealthy, using primary');
        return this.connections.get(this.endpoints[0].url);
    }
    /**
     * Execute a connection method with automatic retry and fallback
     */
    async executeWithRetry(method, methodName = 'unknown') {
        const maxAttempts = this.config.rateLimitRetryAttempts;
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const connection = this.getConnection();
                const endpoint = this.getEndpointForConnection(connection);
                const stats = this.stats.get(endpoint.url);
                const startTime = Date.now();
                stats.requests++;
                // Execute the method
                const result = await method(connection);
                // Update stats on success
                const responseTime = Date.now() - startTime;
                stats.avgResponseTime = (stats.avgResponseTime * 0.9 + responseTime * 0.1);
                stats.lastSuccessTime = Date.now();
                stats.isHealthy = true;
                return result;
            }
            catch (error) {
                lastError = error;
                const errorMsg = error.message || String(error);
                // Check if it's a rate limit error (429)
                if (errorMsg.includes('429') ||
                    errorMsg.includes('Too Many Requests') ||
                    errorMsg.includes('rate limit') ||
                    errorMsg.includes('rate limits exceeded')) {
                    const connection = this.getConnection();
                    const endpoint = this.getEndpointForConnection(connection);
                    const stats = this.stats.get(endpoint.url);
                    stats.rateLimitHits++;
                    stats.lastRateLimitTime = Date.now();
                    // Calculate backoff time (exponential)
                    const backoffMs = this.config.rateLimitBackoffMs * Math.pow(2, attempt - 1);
                    console.warn(`[RPC Manager] Rate limit hit on ${endpoint.type} (attempt ${attempt}/${maxAttempts}). Backing off ${backoffMs}ms`);
                    // Set global backoff
                    this.rateLimitBackoffUntil = Date.now() + backoffMs;
                    // Wait before retry
                    if (attempt < maxAttempts) {
                        await this.sleep(backoffMs);
                        continue;
                    }
                }
                // Check if it's a timeout error
                if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
                    const connection = this.getConnection();
                    const endpoint = this.getEndpointForConnection(connection);
                    const stats = this.stats.get(endpoint.url);
                    stats.errors++;
                    console.warn(`[RPC Manager] Timeout on ${endpoint.type} for ${methodName} (attempt ${attempt}/${maxAttempts})`);
                    if (attempt < maxAttempts) {
                        await this.sleep(1000 * attempt); // Linear backoff for timeouts
                        continue;
                    }
                }
                // For other errors, mark endpoint as potentially unhealthy
                const connection = this.getConnection();
                const endpoint = this.getEndpointForConnection(connection);
                const stats = this.stats.get(endpoint.url);
                stats.errors++;
                // If too many errors, mark as unhealthy
                if (stats.errors > 10 && stats.errors > stats.requests * 0.5) {
                    stats.isHealthy = false;
                    console.warn(`[RPC Manager] Marking ${endpoint.type} as unhealthy (${stats.errors} errors)`);
                }
                if (attempt < maxAttempts) {
                    console.warn(`[RPC Manager] Error on ${methodName}, retrying (${attempt}/${maxAttempts}): ${errorMsg.substring(0, 100)}`);
                    await this.sleep(500 * attempt);
                    continue;
                }
            }
        }
        // All attempts failed
        throw new Error(`[RPC Manager] All ${maxAttempts} attempts failed for ${methodName}: ${lastError?.message || 'Unknown error'}`);
    }
    /**
     * Get endpoint URL for a connection (reverse lookup)
     */
    getEndpointForConnection(connection) {
        for (const endpoint of this.endpoints) {
            if (this.connections.get(endpoint.url) === connection) {
                return endpoint;
            }
        }
        return this.endpoints[0]; // Fallback
    }
    /**
     * Start health monitoring for all endpoints
     */
    startHealthMonitoring() {
        setInterval(() => {
            this.checkEndpointsHealth();
        }, this.config.healthCheckInterval);
    }
    /**
     * Check health of all endpoints and reset unhealthy ones if they've recovered
     */
    async checkEndpointsHealth() {
        for (const endpoint of this.endpoints) {
            const stats = this.stats.get(endpoint.url);
            const now = Date.now();
            // Reset unhealthy status if no errors in last 60 seconds
            if (!stats.isHealthy && now - stats.lastSuccessTime > 60000) {
                console.log(`[RPC Manager] Attempting to restore ${endpoint.type}...`);
                try {
                    const connection = this.connections.get(endpoint.url);
                    await connection.getSlot();
                    stats.isHealthy = true;
                    stats.errors = 0;
                    stats.lastSuccessTime = now;
                    console.log(`[RPC Manager] ✓ ${endpoint.type} restored to healthy`);
                }
                catch (error) {
                    console.warn(`[RPC Manager] ${endpoint.type} still unhealthy: ${error.message.substring(0, 50)}`);
                }
            }
            // Reset rate limit counters if more than 60 seconds passed
            if (now - stats.lastRateLimitTime > 60000) {
                stats.rateLimitHits = 0;
            }
        }
    }
    /**
     * Get statistics for all endpoints
     */
    getStats() {
        return new Map(this.stats);
    }
    /**
     * Print statistics to console
     */
    printStats() {
        console.log('\n[RPC Manager] Endpoint Statistics:');
        console.log('='.repeat(80));
        for (const endpoint of this.endpoints) {
            const stats = this.stats.get(endpoint.url);
            const successRate = stats.requests > 0
                ? ((stats.requests - stats.errors) / stats.requests * 100).toFixed(1)
                : '0.0';
            console.log(`${endpoint.type} (weight: ${endpoint.weight}):`);
            console.log(`  URL: ${endpoint.url.substring(0, 60)}...`);
            console.log(`  Health: ${stats.isHealthy ? '✓ Healthy' : '✗ Unhealthy'}`);
            console.log(`  Requests: ${stats.requests} (${successRate}% success)`);
            console.log(`  Errors: ${stats.errors}`);
            console.log(`  Rate Limits: ${stats.rateLimitHits}`);
            console.log(`  Avg Response: ${stats.avgResponseTime.toFixed(0)}ms`);
            console.log('');
        }
        console.log('='.repeat(80));
    }
    /**
     * Helper: Sleep for ms
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.RpcConnectionManager = RpcConnectionManager;
/**
 * Create RPC Manager from environment variables
 */
function createRpcManagerFromEnv() {
    const endpoints = [];
    // Primary RPC (from RPC_URL)
    const primaryRpc = process.env.RPC_URL;
    if (primaryRpc) {
        endpoints.push({
            url: primaryRpc,
            weight: 100,
            type: primaryRpc.includes('helius') ? 'helius' :
                primaryRpc.includes('quicknode') ? 'quicknode' :
                    primaryRpc.includes('api.mainnet-beta.solana.com') ? 'public' :
                        'custom',
        });
    }
    // Helius RPC (if different from primary)
    const heliusRpc = process.env.HELIUS_RPC;
    if (heliusRpc && heliusRpc !== primaryRpc) {
        endpoints.push({
            url: heliusRpc,
            weight: 90,
            type: 'helius',
            maxRequestsPerSecond: 100, // Helius free tier limit
        });
    }
    // Fallback to public RPC if nothing else is configured
    if (endpoints.length === 0) {
        console.warn('[RPC Manager] No RPC URLs configured, using public Solana RPC (VERY LIMITED)');
        endpoints.push({
            url: 'https://api.mainnet-beta.solana.com',
            weight: 10,
            type: 'public',
            maxRequestsPerSecond: 1, // Very limited
        });
    }
    // Add recommended free RPCs as fallbacks
    endpoints.push({
        url: 'https://solana-api.projectserum.com',
        weight: 20,
        type: 'public',
        maxRequestsPerSecond: 5,
    }, {
        url: 'https://rpc.ankr.com/solana',
        weight: 15,
        type: 'public',
        maxRequestsPerSecond: 5,
    });
    return new RpcConnectionManager({
        endpoints,
        commitment: 'confirmed',
        rateLimitRetryAttempts: 5,
        rateLimitBackoffMs: 1000,
    });
}
