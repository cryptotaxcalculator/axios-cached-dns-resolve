import { AxiosInstance } from "axios";
import LRUCache from "lru-cache";
export interface Config {
  disabled: boolean;
  dnsTtlMs: number;
  cacheGraceExpireMultiplier: number;
  dnsIdleTtlMs: number;
  backgroundScanMs: number;
  dnsCacheSize: number;
  logging: LoggingConfig;
  cache?: LRUCache<string, DnsEntry>;
}

export interface CacheConfig {
  max: number;
  ttl: number;
}

export interface Stats {
  dnsEntries: number;
  refreshed: number;
  hits: number;
  misses: number;
  idleExpired: number;
  errors: number;
  lastError: unknown;
  lastErrorTs: number;
}

interface LoggingConfig {
  name: string;
  level: string;
  prettyPrint: boolean;
  formatters: {
    level: (label: string) => { level: string };
  };
}

export interface DnsEntry {
  host: string;
  ips: string[];
  nextIdx: number;
  lastUsedTs: number;
  updatedTs: number;
}

declare module "axios-cached-dns-resolve" {
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
