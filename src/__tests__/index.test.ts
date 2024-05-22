import axios, { AxiosInstance } from "axios";
import delay from "delay";
import * as axiosCachingDns from "..";
import { DNSEntryCache } from "../DNSEntryCache";
import { Config } from "../index.d";

let axiosClient: AxiosInstance;
let useRedis: boolean = false; // Flag to switch between Redis and LRU

beforeEach(async () => {
  axiosCachingDns.config.dnsTtlMs = 1000;
  axiosCachingDns.config.dnsIdleTtlMs = 5000;
  axiosCachingDns.config.cacheGraceExpireMultiplier = 2;
  axiosCachingDns.config.backgroundScanMs = 100;

  if (useRedis) {
    axiosCachingDns.config.redisConfig = {
      url: "localhost:6379",
      ttl:
        (axiosCachingDns.config.dnsTtlMs *
          axiosCachingDns.config.cacheGraceExpireMultiplier) /
        1000,
    };
    axiosCachingDns.config.lruCacheConfig = undefined;
  } else {
    axiosCachingDns.config.lruCacheConfig = {
      max: axiosCachingDns.config.dnsCacheSize,
      ttl:
        axiosCachingDns.config.dnsTtlMs *
        axiosCachingDns.config.cacheGraceExpireMultiplier, // grace for refresh
    };
    axiosCachingDns.config.redisConfig = undefined;
  }

  axiosCachingDns.config.cache = new DNSEntryCache(
    axiosCachingDns.config,
    true // Create a fresh cache on each run
  );

  axiosClient = axios.create({
    timeout: 5000,
  });

  axiosCachingDns.registerInterceptor(axiosClient);

  axiosCachingDns.startBackgroundRefresh();
  axiosCachingDns.startPeriodicCachePrune();
});

afterAll(() => {
  axiosCachingDns.config.cache?.clear();
  axiosCachingDns.reset();
});

describe("Initialization Tests", () => {
  test("init function with custom config", async () => {
    const customConfig = {
      disabled: false,
      dnsTtlMs: 3000,
      cacheGraceExpireMultiplier: 3,
      dnsIdleTtlMs: 2000,
      backgroundScanMs: 1500,
      dnsCacheSize: 50,
      logging: {
        name: "test-logger",
        level: "debug",
        prettyPrint: true,
        formatters: {
          level: (label: string) => ({ level: label }),
        },
      },
      redisConfig: undefined,
      lruCacheConfig: {
        max: 50,
        ttl: 9000,
      },
    } as Config;

    axiosCachingDns.init(customConfig);
    expect(axiosCachingDns.config).toEqual(customConfig);
  });
});

describe("LRU Cache Tests", () => {
  beforeAll(async () => {
    useRedis = false;
    await clearStats();
  });

  runTests();
});

describe("Redis Cache Tests", () => {
  beforeAll(() => {
    useRedis = true;
    clearStats();
  });

  runTests();
});

function runTests() {
  test("query google with baseURL and relative url", async () => {
    axiosCachingDns.registerInterceptor(axios);

    const { data } = await axios.get("/finance", {
      baseURL: "http://www.google.com",
      // headers: { Authorization: `Basic ${basicauth}` },
    });
    expect(data).toBeTruthy();
    expect((await axiosCachingDns.getStats()).dnsEntries).toBe(1);
    expect((await axiosCachingDns.getStats()).misses).toBe(1);

    const dnsCacheEntries = await axiosCachingDns.getDnsCacheEntries();
    expect(Array.isArray(dnsCacheEntries)).toBeTruthy();
    expect(Array.isArray(dnsCacheEntries[0].ips)).toBeTruthy();
    expect(dnsCacheEntries[0].ips[0]).toBeTruthy();
    expect(dnsCacheEntries[0].host).toBeTruthy();
    expect(dnsCacheEntries[0].lastUsedTs).toBeTruthy();
    expect(dnsCacheEntries[0].updatedTs).toBeTruthy();
  });

  test("query google caches and after idle delay uncached", async () => {
    const resp = await axiosClient.get("http://google.com");
    expect(resp.data).toBeTruthy();
    expect(await axiosCachingDns.config.cache?.get("google.com")).toBeTruthy();
    await delay(6000);
    expect(await axiosCachingDns.config.cache?.get("google.com")).toBeFalsy();

    const expectedStats = {
      dnsEntries: 0,
      refreshed: 0,
      hits: 0,
      misses: 2,
      idleExpired: 1,
      errors: 0,
      lastError: 0,
      lastErrorTs: 0,
    };

    const stats = await axiosCachingDns.getStats();
    stats.refreshed = 0;
    expect(stats).toEqual(expectedStats);
  });

  test("query google caches and refreshes", async () => {
    await axiosClient.get("http://google.com");
    const dnsEntry = await axiosCachingDns.config.cache?.get("google.com");
    if (!dnsEntry) throw new Error("DNS entry for google.com not found");
    const { updatedTs } = dnsEntry;
    const timeoutTime = Date.now() + 5000;
    while (true) {
      const dnsEntry = await axiosCachingDns.config.cache?.get("google.com");
      if (!dnsEntry) throw new Error("dnsEntry missing or expired");
      if (updatedTs !== dnsEntry.updatedTs) break;
      if (Date.now() > timeoutTime) throw new Error("Timeout exceeded");
      await delay(10);
    }

    const expectedStats = {
      dnsEntries: 1,
      refreshed: 0,
      hits: 0,
      misses: 3,
      idleExpired: 1,
      errors: 0,
      lastError: 0,
      lastErrorTs: 0,
    };

    const stats = await axiosCachingDns.getStats();
    stats.refreshed = 0;
    expect(stats).toEqual(expectedStats);
  });

  test("query two services, caches and after one idle delay uncached", async () => {
    await axiosClient.get("http://amazon.com");

    await axiosClient.get("http://microsoft.com");
    const dnsEntry = await axiosCachingDns.config.cache?.get("microsoft.com");
    if (!dnsEntry) throw new Error("DNS entry for microsoft.com not found");
    const { lastUsedTs } = dnsEntry;
    expect(dnsEntry.nextIdx).toBe(1);

    await axiosClient.get("http://microsoft.com");
    const dnsEntry2 = await axiosCachingDns.config.cache?.get("microsoft.com");
    if (!dnsEntry2) throw new Error("DNS entry for microsoft.com not found");
    expect(dnsEntry2.nextIdx).toBe(2);

    expect(lastUsedTs < dnsEntry2.lastUsedTs).toBeTruthy();

    expect(axiosCachingDns.config.cache?.size).toBe(2);
    await axiosClient.get("http://microsoft.com");
    const dnsEntry3 = await axiosCachingDns.config.cache?.get("microsoft.com");
    if (!dnsEntry3) throw new Error("DNS entry for microsoft.com not found");
    expect(dnsEntry3.nextIdx).toBe(3);

    expect(lastUsedTs !== dnsEntry3.lastUsedTs).toBeTruthy();

    expect(axiosCachingDns.config.cache?.size).toBe(2);
    await delay(4000);
    expect(axiosCachingDns.config.cache?.size).toBe(1);
    await delay(2000);
    expect(axiosCachingDns.config.cache?.size).toBe(0);

    const expectedStats = {
      dnsEntries: 0,
      refreshed: 0,
      hits: 2,
      misses: 5,
      idleExpired: 3,
      errors: 0,
      lastError: 0,
      lastErrorTs: 0,
    };

    const stats = await axiosCachingDns.getStats();
    stats.refreshed = 0;
    expect(stats).toEqual(expectedStats);
  });

  test("validate axios config not altered", async () => {
    const baseURL = "http://microsoft.com";
    const axiosConfig = { baseURL };
    const custAxiosClient = axios.create(axiosConfig);

    axiosCachingDns.registerInterceptor(custAxiosClient);

    await custAxiosClient.get("/");
    expect(baseURL).toBe(axiosConfig.baseURL);
    await custAxiosClient.get("/");
    expect(baseURL).toBe(axiosConfig.baseURL);
  });

  test("validate axios get config not altered", async () => {
    const url = "http://microsoft.com";
    const custAxiosClient = axios.create();

    const reqConfig = {
      method: "get",
      url,
    };

    axiosCachingDns.registerInterceptor(custAxiosClient);

    await custAxiosClient.get(url, reqConfig);
    expect(url).toBe(reqConfig.url);
    await custAxiosClient.get(url, reqConfig);
    expect(url).toBe(reqConfig.url);
  });

  test("validate axios request config not altered", async () => {
    const url = "http://microsoft.com";
    const custAxiosClient = axios.create();

    const reqConfig = {
      method: "get",
      url,
    };

    axiosCachingDns.registerInterceptor(custAxiosClient);

    await custAxiosClient.request(reqConfig);
    expect(url).toBe(reqConfig.url);
    await custAxiosClient.request(reqConfig);
    expect(url).toBe(reqConfig.url);
  });
}

async function clearStats() {
  const stats = await axiosCachingDns.getStats();
  stats.dnsEntries = 0;
  stats.refreshed = 0;
  stats.hits = 0;
  stats.misses = 0;
  stats.idleExpired = 0;
  stats.errors = 0;
  stats.lastError = 0;
  stats.lastErrorTs = 0;
}
