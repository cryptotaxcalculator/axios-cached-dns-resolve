import Redis from "ioredis";
import stringify from "json-stringify-safe";
import LRUCache from "lru-cache";
import { config } from "./axios-cached-dns-resolve";
import { CacheInterface, Config, DnsEntry } from "./index.d";

export class DNSEntryCache implements CacheInterface {
  private lruCache?: LRUCache<string, DnsEntry>;
  private redisCache?: Redis;
  public size: number = 0;

  constructor(config: Config, fresh?: boolean) {
    if (config.redisConfig) {
      // Initialize Redis cache
      this.redisCache = new Redis(config.redisConfig.url, {
        password: config.redisConfig.password,
      });

      // If fresh is true, clear the cache
      if (fresh) {
        this.clear();
      }
    } else if (config.lruCacheConfig) {
      // Initialize LRU cache
      this.lruCache = new LRUCache<string, DnsEntry>(config.lruCacheConfig);
    } else {
      // Default to LRU cache
      this.lruCache = new LRUCache<string, DnsEntry>({
        max: 100,
        ttl: 10000,
      });
    }
  }

  async get(key: string): Promise<DnsEntry | null> {
    if (this.redisCache) {
      const entry = await this.redisCache.get(key);
      return entry ? JSON.parse(entry) : null;
    } else if (this.lruCache) {
      return this.lruCache.get(key) || null;
    }
    return null;
  }

  async set(key: string, value: DnsEntry): Promise<void> {
    const isNewEntry = this.redisCache
      ? !(await this.redisCache.exists(key))
      : !this.lruCache?.has(key);
    if (this.redisCache) {
      await this.redisCache.setex(
        key,
        config.redisConfig?.ttl || 5,
        stringify(value)
      );
    } else if (this.lruCache) {
      this.lruCache.set(key, value);
    }
    if (isNewEntry) {
      this.size++;
    }
  }

  async entries(): Promise<DnsEntry[]> {
    if (this.redisCache) {
      const keys = await this.redisCache.keys("*");
      return Promise.all(keys.map(async (key) => this.get(key))).then(
        (entries) =>
          entries.filter(
            (entry): entry is DnsEntry => entry !== null
          ) as DnsEntry[]
      );
    } else if (this.lruCache) {
      return Array.from(this.lruCache.entries()).map((entry) => entry[1]);
    }
    return [];
  }

  async purgeStale(): Promise<void> {
    if (this.redisCache) {
      // Redis does not need manual purging if 'EX' is set
    } else if (this.lruCache) {
      this.lruCache.purgeStale();
    }
  }

  async delete(key: string): Promise<void> {
    const exists = this.redisCache
      ? await this.redisCache.exists(key)
      : this.lruCache?.has(key);
    if (this.redisCache) {
      await this.redisCache.del(key);
    } else if (this.lruCache) {
      this.lruCache.delete(key);
    }
    if (exists) {
      this.size--;
    }
  }

  async clear(): Promise<void> {
    if (this.redisCache) {
      await this.redisCache.flushall();
    } else if (this.lruCache) {
      this.lruCache.clear();
    }
    this.size = 0;
  }
}
