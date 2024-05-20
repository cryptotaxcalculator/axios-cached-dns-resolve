import { AxiosInstance } from "axios";
import dns from "dns";
import stringify from "json-stringify-safe";
import LRUCache from "lru-cache";
import net from "net";
import { Logger } from "pino";
import URL from "url";
import util from "util";
import { CacheConfig, Config, DnsEntry, Stats } from "./index.d";
import { init as initLogger } from "./logging";

const dnsResolve = util.promisify(dns.resolve);
const dnsLookup = util.promisify(dns.lookup);

export const config = {
  disabled: process.env.AXIOS_DNS_DISABLE === "true",
  dnsTtlMs: parseInt(process.env.AXIOS_DNS_CACHE_TTL_MS || "5000"), // when to refresh actively used dns entries (5 sec)
  cacheGraceExpireMultiplier: parseInt(
    process.env.AXIOS_DNS_CACHE_EXPIRE_MULTIPLIER || "2"
  ), // maximum grace to use entry beyond TTL
  dnsIdleTtlMs:
    parseInt(process.env.AXIOS_DNS_CACHE_IDLE_TTL_MS || "1000") * 60 * 60, // when to remove entry entirely if not being used (1 hour)
  backgroundScanMs: parseInt(
    process.env.AXIOS_DNS_BACKGROUND_SCAN_MS || "2400"
  ), // how frequently to scan for expired TTL and refresh (2.4 sec)
  dnsCacheSize: parseInt(process.env.AXIOS_DNS_CACHE_SIZE || "100"), // maximum number of entries to keep in cache
  // pino logging options
  logging: {
    name: "axios-cache-dns-resolve",
    // enabled: true,
    level: process.env.AXIOS_DNS_LOG_LEVEL || "info", // default 'info' others trace, debug, info, warn, error, and fatal
    // timestamp: true,
    prettyPrint: process.env.NODE_ENV === "DEBUG" || false,
    formatters: {
      level: (label: string) => {
        return { level: label };
      },
    },
  },
  cache: undefined as LRUCache<string, DnsEntry> | undefined,
} as Config;

export const cacheConfig = {
  max: config.dnsCacheSize,
  ttl: config.dnsTtlMs * config.cacheGraceExpireMultiplier, // grace for refresh
} as CacheConfig;

export const stats = {
  dnsEntries: 0,
  refreshed: 0,
  hits: 0,
  misses: 0,
  idleExpired: 0,
  errors: 0,
  lastError: 0,
  lastErrorTs: 0,
} as Stats;

let log: Logger;
let backgroundRefreshId: NodeJS.Timeout;
let cachePruneId: NodeJS.Timeout;

init();

export function init() {
  log = initLogger(config.logging);

  if (config.cache) return;

  config.cache = new LRUCache<string, DnsEntry>(cacheConfig);

  startBackgroundRefresh();
  startPeriodicCachePrune();
}

export function reset() {
  if (backgroundRefreshId) {
    clearInterval(backgroundRefreshId);
    backgroundRefreshId.unref();
  }
  if (cachePruneId) {
    clearInterval(cachePruneId);
    cachePruneId.unref();
  }
}

export function startBackgroundRefresh() {
  if (backgroundRefreshId) {
    clearInterval(backgroundRefreshId);
    backgroundRefreshId.unref();
  }

  backgroundRefreshId = setInterval(backgroundRefresh, config.backgroundScanMs);
}

export function startPeriodicCachePrune() {
  if (cachePruneId) {
    clearInterval(cachePruneId);
    cachePruneId.unref();
  }

  cachePruneId = setInterval(
    () => config.cache?.purgeStale(),
    config.dnsIdleTtlMs
  );
}

export function getStats() {
  stats.dnsEntries = config.cache?.size || 0;
  return stats;
}

export function getDnsCacheEntries() {
  return Array.from(config.cache?.values() || []);
}

// const dnsEntry = {
//   host: 'www.amazon.com',
//   ips: [
//     '52.54.40.141',
//     '34.205.98.207',
//     '3.82.118.51',
//   ],
//   nextIdx: 0,
//   lastUsedTs: 1555771516581, Date.now()
//   updatedTs: 1555771516581,
// }

export function registerInterceptor(axios: AxiosInstance) {
  if (config.disabled || !axios || !axios.interceptors) return; // supertest
  axios.interceptors.request.use(async (reqConfig) => {
    try {
      if (!reqConfig.headers) {
        reqConfig.headers = {};
      }

      let url;
      if (reqConfig.baseURL) {
        url = URL.parse(reqConfig.baseURL);
      } else {
        url = URL.parse(reqConfig.url || "");
      }

      if (net.isIP(url.hostname || "")) return reqConfig; // skip

      reqConfig.headers.Host = url.hostname || ""; // set hostname in header

      url.hostname = await getAddress(url.hostname || "");
      url.host = null; // clear hostname

      if (reqConfig.baseURL) {
        reqConfig.baseURL = URL.format(url);
      } else {
        reqConfig.url = URL.format(url);
      }
    } catch (err) {
      recordError(
        err,
        `Error getAddress, ${
          err instanceof Error ? err.message : "an unknown error occurred"
        }`
      );
    }

    return reqConfig;
  });
}

export async function getAddress(host: string) {
  let dnsEntry = config.cache?.get(host);
  if (dnsEntry) {
    stats.hits += 1;
    dnsEntry.lastUsedTs = Date.now();
    // eslint-disable-next-line no-plusplus
    const ip = dnsEntry.ips[dnsEntry.nextIdx++ % dnsEntry.ips.length]; // round-robin
    config.cache?.set(host, dnsEntry);
    return ip;
  }
  stats.misses += 1;
  if (log.isLevelEnabled("debug")) log.debug(`cache miss ${host}`);

  const ips = await resolve(host);
  dnsEntry = {
    host,
    ips,
    nextIdx: 0,
    lastUsedTs: Date.now(),
    updatedTs: Date.now(),
  } as DnsEntry;
  // eslint-disable-next-line no-plusplus
  const ip = dnsEntry.ips[dnsEntry.nextIdx++ % dnsEntry.ips.length]; // round-robin
  config.cache?.set(host, dnsEntry);
  return ip;
}

let backgroundRefreshing = false;
export async function backgroundRefresh() {
  if (backgroundRefreshing) return; // don't start again if currently iterating slowly
  backgroundRefreshing = true;
  try {
    for (const [key, value] of config.cache?.entries() || []) {
      try {
        if (value.updatedTs + config.dnsTtlMs > Date.now()) {
          continue; // skip
        }
        if (value.lastUsedTs + config.dnsIdleTtlMs <= Date.now()) {
          stats.idleExpired += 1;
          config.cache?.delete(key);
          continue;
        }
        const ips = await resolve(value.host);
        value.ips = ips;
        value.updatedTs = Date.now();
        config.cache?.set(key, value);
        stats.refreshed += 1;
      } catch (err) {
        // best effort
        recordError(
          err,
          `Error backgroundRefresh host: ${key}, ${stringify(value)}, ${
            err instanceof Error ? err.message : "an unknown error occurred"
          }`
        );
      }
    }
  } catch (err) {
    // best effort
    recordError(
      err,
      `Error backgroundRefresh, ${
        err instanceof Error ? err.message : "an unknown error occurred"
      }`
    );
  } finally {
    backgroundRefreshing = false;
  }
}

/**
 *
 * @param host
 * @returns {*[]}
 */
async function resolve(host: string) {
  let ips;
  try {
    ips = await dnsResolve(host);
  } catch (e) {
    const lookupResp = await dnsLookup(host, { all: true }); // pass options all: true for all addresses
    const addresses = extractAddresses(lookupResp);
    if (!Array.isArray(addresses) || addresses.length < 1)
      throw new Error(`fallback to dnsLookup returned no address ${host}`);
    ips = addresses;
  }
  return ips;
}

// dns.lookup
// ***************** { address: '142.250.190.68', family: 4 }
// , { all: true } /***************** [ { address: '142.250.190.68', family: 4 } ]

function extractAddresses(lookupResp: dns.LookupAddress[]) {
  if (!Array.isArray(lookupResp))
    throw new Error("lookup response did not contain array of addresses");
  return lookupResp.filter((e) => e.address != null).map((e) => e.address);
}

function recordError(err: unknown, errMesg: string) {
  stats.errors += 1;
  stats.lastError = err;
  stats.lastErrorTs = Date.now();
  log.error(err, errMesg);
}
