# Changelog

## [3.3.2] - 2024-05-02

### Fixed

- Fixed types (for Config, CacheConfig, Stats, DnsEntry)

## [3.3.1] - 2024-04-30

### Fixed

- Fixed NPM publish issues

## [3.3.0] - 2024-04-30

### Changed

- Added type safety (via Typescript)
- Changed module resolution to use CJS
- Changed test runner from ava to jest

## [3.2.2] - 2022-09-06

### Fixed

- Merged community PR (thanks matrec4) 'Adding a .d.ts file to declare the module for tsnode' [#29](https://github.com/tcollinsworth/axios-cached-dns-resolve/pull/29)


## [3.2.1] - 2022-09-06

### Fixed

- Fixed bug were getDnsCacheEntries was returning generator from lru-cache to instead return array


## [3.2.0] - 2022-09-06

### Changed

- Updated lru-cache to latest version

### Fixed

- Fixed bug were fallback from dns.resolve failure to dns.lookup was not interpreting response array
