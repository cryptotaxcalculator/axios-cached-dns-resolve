const axiosCachedDnsResolve = require('./axios-cached-dns-resolve.js')

module.exports = {
  config: axiosCachedDnsResolve.config,
  cacheConfig: axiosCachedDnsResolve.cacheConfig,
  stats: axiosCachedDnsResolve.stats,
  init: axiosCachedDnsResolve.init,
  reset: axiosCachedDnsResolve.reset,
  startBackgroundRefresh: axiosCachedDnsResolve.startBackgroundRefresh,
  startPeriodicCachePrune: axiosCachedDnsResolve.startPeriodicCachePrune,
  getStats: axiosCachedDnsResolve.getStats,
  getDnsCacheEntries: axiosCachedDnsResolve.getDnsCacheEntries,
  registerInterceptor: axiosCachedDnsResolve.registerInterceptor,
  getAddress: axiosCachedDnsResolve.getAddress,
  backgroundRefresh: axiosCachedDnsResolve.backgroundRefresh,
}
