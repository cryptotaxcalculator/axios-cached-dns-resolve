import delay from 'delay';
import LRUCache from 'lru-cache';
import axios, { AxiosInstance } from 'axios';
import * as axiosCachingDns from '..';

let axiosClient: AxiosInstance;

beforeEach(() => {
  axiosCachingDns.config.dnsTtlMs = 1000;
  axiosCachingDns.config.dnsIdleTtlMs = 5000;
  axiosCachingDns.config.cacheGraceExpireMultiplier = 2;
  axiosCachingDns.config.backgroundScanMs = 100;

  axiosCachingDns.cacheConfig.ttl = (axiosCachingDns.config.dnsTtlMs * axiosCachingDns.config.cacheGraceExpireMultiplier);

  axiosCachingDns.config.cache = new LRUCache(axiosCachingDns.cacheConfig);

  axiosClient = axios.create({
    timeout: 5000,
    // maxRedirects: 0,
  });

  axiosCachingDns.registerInterceptor(axiosClient);

  axiosCachingDns.startBackgroundRefresh();
  axiosCachingDns.startPeriodicCachePrune();
});

afterAll(() => {
  axiosCachingDns.config.cache?.clear();
  axiosCachingDns.reset();
});

test('query google with baseURL and relative url', async () => {
  axiosCachingDns.registerInterceptor(axios);

  const { data } = await axios.get('/finance', {
    baseURL: 'http://www.google.com',
    // headers: { Authorization: `Basic ${basicauth}` },
  });
  expect(data).toBeTruthy();
  expect(axiosCachingDns.getStats().dnsEntries).toBe(1);
  expect(axiosCachingDns.getStats().misses).toBe(1);

  const dnsCacheEntries = axiosCachingDns.getDnsCacheEntries();
  expect(Array.isArray(dnsCacheEntries)).toBeTruthy();
  expect(Array.isArray(dnsCacheEntries[0].ips)).toBeTruthy();
  expect(dnsCacheEntries[0].ips[0]).toBeTruthy();
  expect(dnsCacheEntries[0].host).toBeTruthy();
  expect(dnsCacheEntries[0].lastUsedTs).toBeTruthy();
  expect(dnsCacheEntries[0].updatedTs).toBeTruthy();
});

test('query google caches and after idle delay uncached', async () => {
  const resp = await axiosClient.get('http://google.com');
  expect(resp.data).toBeTruthy();
  expect(axiosCachingDns.config.cache?.get('google.com')).toBeTruthy();
  await delay(6000);
  expect(axiosCachingDns.config.cache?.get('google.com')).toBeFalsy();

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

  const stats = axiosCachingDns.getStats();
  stats.refreshed = 0;
  expect(stats).toEqual(expectedStats);
});

test('query google caches and refreshes', async () => {
  await axiosClient.get('http://google.com');
  const { updatedTs } = axiosCachingDns.config.cache?.get('google.com');
  const timeoutTime = Date.now() + 5000;
  while (true) {
    const dnsEntry = axiosCachingDns.config.cache?.get('google.com');
    if (!dnsEntry) throw new Error('dnsEntry missing or expired');
    if (updatedTs !== dnsEntry.updatedTs) break;
    if (Date.now() > timeoutTime) throw new Error('Timeout exceeded');
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

  const stats = axiosCachingDns.getStats();
  stats.refreshed = 0;
  expect(stats).toEqual(expectedStats);
});

test('query two services, caches and after one idle delay uncached', async () => {
  await axiosClient.get('http://amazon.com');

  await axiosClient.get('http://microsoft.com');
  const { lastUsedTs } = axiosCachingDns.config.cache?.get('microsoft.com');
  expect(axiosCachingDns.config.cache?.get('microsoft.com').nextIdx).toBe(1);

  await axiosClient.get('http://microsoft.com');
  expect(axiosCachingDns.config.cache?.get('microsoft.com').nextIdx).toBe(2);

  expect(lastUsedTs < axiosCachingDns.config.cache?.get('microsoft.com').lastUsedTs).toBeTruthy();

  expect(axiosCachingDns.config.cache?.size).toBe(2);
  await axiosClient.get('http://microsoft.com');
  expect(axiosCachingDns.config.cache?.get('microsoft.com').nextIdx).toBe(3);

  expect(lastUsedTs !== axiosCachingDns.config.cache?.get('microsoft.com').lastUsedTs).toBeTruthy();

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

  const stats = axiosCachingDns.getStats();
  stats.refreshed = 0;
  expect(stats).toEqual(expectedStats);
});

test('validate axios config not altered', async () => {
  const baseURL = 'http://microsoft.com';
  const axiosConfig = { baseURL };
  const custAxiosClient = axios.create(axiosConfig);

  axiosCachingDns.registerInterceptor(custAxiosClient);

  await custAxiosClient.get('/');
  expect(baseURL).toBe(axiosConfig.baseURL);
  await custAxiosClient.get('/');
  expect(baseURL).toBe(axiosConfig.baseURL);
});

test('validate axios get config not altered', async () => {
  const url = 'http://microsoft.com';
  const custAxiosClient = axios.create();

  const reqConfig = {
    method: 'get',
    url,
  };

  axiosCachingDns.registerInterceptor(custAxiosClient);

  await custAxiosClient.get(url, reqConfig);
  expect(url).toBe(reqConfig.url);
  await custAxiosClient.get(url, reqConfig);
  expect(url).toBe(reqConfig.url);
});

test('validate axios request config not altered', async () => {
  const url = 'http://microsoft.com';
  const custAxiosClient = axios.create();

  const reqConfig = {
    method: 'get',
    url,
  };

  axiosCachingDns.registerInterceptor(custAxiosClient);

  await custAxiosClient.request(reqConfig);
  expect(url).toBe(reqConfig.url);
  await custAxiosClient.request(reqConfig);
  expect(url).toBe(reqConfig.url);
});