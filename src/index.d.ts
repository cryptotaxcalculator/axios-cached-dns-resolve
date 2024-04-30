import { AxiosInstance } from "axios";
import LRUCache from "lru-cache";

declare module "axios-cached-dns-resolve" {
  interface Config {
    disabled: boolean;
    dnsTtlMs: number;
    cacheGraceExpireMultiplier: number;
    dnsIdleTtlMs: number;
    backgroundScanMs: number;
    dnsCacheSize: number;
    logging: LoggingConfig;
    cache?: LRUCache<string, string[]>;
  }

  interface CacheConfig {
    max: number;
    ttl: number;
  }

  interface Stats {
    dnsEntries: number;
    refreshed: number;
    hits: number;
    misses: number;
    idleExpired: number;
    errors: number;
    lastError: any;
    lastErrorTs: string;
  }

  interface LoggingConfig {
    name: string;
    level: string;
    prettyPrint: boolean;
    formatters: {
      level: (label: string) => { level: string };
    };
  }

  interface DnsEntry {
    host: string;
    ips: string[];
    nextIdx: number;
    lastUsedTs: number;
    updatedTs: number;
  }

  export function init(): void;
  export function startBackgroundRefresh(): void;
  export function startPeriodicCachePrune(): void;
  export function getStats(): Stats;
  export function getDnsCacheEntries(): DnsEntry[];
  export function registerInterceptor(axios: AxiosInstance): void;
  export function getAddress(host: string): Promise<string>;
  export function backgroundRefresh(): Promise<void>;
  export function resolve(host: string): Promise<string[]>;
}
