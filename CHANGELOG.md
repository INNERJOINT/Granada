## [2.10.0](https://github.com/INNERJOINT/Granada/compare/v2.9.0...v2.10.0) (2026-05-26)

### Features

* **aosp:** add native consensus planning agents ([17974ec](https://github.com/INNERJOINT/Granada/commit/17974ec760dcce2fb6596f8988bc4c616c9e4dec))
* **aosp:** add sourcepilot-aware consensus agents ([f8eb723](https://github.com/INNERJOINT/Granada/commit/f8eb7232b9965ea26272441b4799535d7ef188f5))
* **aosp:** improve plan evidence reporting ([d635ffa](https://github.com/INNERJOINT/Granada/commit/d635ffa82c6cce1a8f9eb0f2015142fab41a6147))
* **aosp:** route feature import through aosp-plan ([ead75b1](https://github.com/INNERJOINT/Granada/commit/ead75b1e3e5460020a4c114c2b016376a97f2f82))
* **aosp:** strengthen plan consensus artifacts ([0a38258](https://github.com/INNERJOINT/Granada/commit/0a382588dd5a10b23917b0ebe95b375cd858ce43))
* **aosp:** structure architect consensus review ([8bf5d56](https://github.com/INNERJOINT/Granada/commit/8bf5d56ac01950440ceb2897424614eae5c49399))
* **aosp:** tighten plan consensus evidence scope ([cf78bc2](https://github.com/INNERJOINT/Granada/commit/cf78bc2296f21757242c3f741ae34ab66cfa2e4d))

## [2.9.0](https://github.com/INNERJOINT/Granada/compare/v2.8.2...v2.9.0) (2026-05-26)

### Features

* **aosp:** record local repo path for project workflows ([e0aad7e](https://github.com/INNERJOINT/Granada/commit/e0aad7ea48b7ac5433a35697adad226321214f00))

### Bug Fixes

* **ci:** allow manual release workflow dispatch ([8f5e35b](https://github.com/INNERJOINT/Granada/commit/8f5e35b3e5eabe13924584757c3ec23aa550adc1))

## [2.8.2](https://github.com/INNERJOINT/Granada/compare/v2.8.1...v2.8.2) (2026-05-26)

### Bug Fixes

* **agents:** enumerate sourcepilot tools instead of wildcard ([4461a32](https://github.com/INNERJOINT/Granada/commit/4461a327afaefda596099582ebe6fc7a319b5a0f))

## [2.8.1](https://github.com/INNERJOINT/Granada/compare/v2.8.0...v2.8.1) (2026-05-26)

### Bug Fixes

* **mcp:** use mcp__plugin_zaku_sourcepilot__* tool names ([7e1536e](https://github.com/INNERJOINT/Granada/commit/7e1536e7bb905cce83b4c15a1475a401f8989005))

## [2.8.0](https://github.com/INNERJOINT/Granada/compare/v2.7.0...v2.8.0) (2026-05-21)

### Features

* **skills:** update aosp-analyst model to opus ([27f2275](https://github.com/INNERJOINT/Granada/commit/27f22759bd80b917b4e74c16da0bac2db5c67cbd))

## [2.7.0](https://github.com/INNERJOINT/Granada/compare/v2.6.1...v2.7.0) (2026-05-20)

### Features

* **skills:** split aosp-analyze into aosp-rca and general technical report ([05ef40e](https://github.com/INNERJOINT/Granada/commit/05ef40e1701b31c9b52ad88f7ab66e8ad0c1a9b4))

### Bug Fixes

* **skills:** preserve namespaced command hints ([37c0372](https://github.com/INNERJOINT/Granada/commit/37c03726370e35803adc8c890e46164008c37c1c))
* **skills:** prune redundant frontmatter and ignore firecrawl cache ([626b03f](https://github.com/INNERJOINT/Granada/commit/626b03faa396d37e57a290e17e22dee7cb843ff8))

## [2.6.1](https://github.com/INNERJOINT/Granada/compare/v2.6.0...v2.6.1) (2026-05-20)

### Bug Fixes

* **skills:** quote argument hints ([aee8767](https://github.com/INNERJOINT/Granada/commit/aee87678f151f3b07df0cf3db1ef6d66f1a4f578))

## [2.6.0](https://github.com/INNERJOINT/Granada/compare/v2.5.0...v2.6.0) (2026-05-20)

### Features

* **output-styles:** use box-drawing diagrams ([10e1bb2](https://github.com/INNERJOINT/Granada/commit/10e1bb2d7db906068d3f5a34c10bcdbe049421ff))

## [2.5.0](https://github.com/INNERJOINT/Granada/compare/v2.4.0...v2.5.0) (2026-05-20)

### Features

* **output-styles:** add diagrams-first style ([9e4564b](https://github.com/INNERJOINT/Granada/commit/9e4564b3e7d3e6509741381129f93ada14ce468e))

## [2.4.0](https://github.com/INNERJOINT/Granada/compare/v2.3.0...v2.4.0) (2026-05-20)

### Features

* **skills:** delegate log collection to agent ([8a7cf47](https://github.com/INNERJOINT/Granada/commit/8a7cf476bb58b56326a9e3bbae1f6475a2c54994))

## [2.3.0](https://github.com/INNERJOINT/Granada/compare/v2.2.0...v2.3.0) (2026-05-19)

### Features

* **hooks:** add per-event hook scripts covering all 29 hook events ([4754cb0](https://github.com/INNERJOINT/Granada/commit/4754cb060e2f28c25913a1149b18651c8c9fca50))
* **hooks:** add vitest testing framework with contract tests for all 29 hook events ([cd49a71](https://github.com/INNERJOINT/Granada/commit/cd49a71485ef24f0f9de46787db8d0b1c1f3bee8))
* **skills:** add model tier routing to all skill definitions ([3b495fa](https://github.com/INNERJOINT/Granada/commit/3b495fac5ee674b356f0b6564837824de173cad6))

## [2.2.0](https://github.com/INNERJOINT/Granada/compare/v2.1.0...v2.2.0) (2026-05-19)

### Features

* **mcp:** add atlassian MCP server and remove default values ([1ef6fab](https://github.com/INNERJOINT/Granada/commit/1ef6fab47aa98ec45d35669545c035a17ab12d2e))

## [2.1.0](https://github.com/INNERJOINT/Granada/compare/v2.0.1...v2.1.0) (2026-05-19)

### Features

* **plugin:** add GitLab MCP server with secure userConfig ([92d69ca](https://github.com/INNERJOINT/Granada/commit/92d69caee2d8d1c2135d7f9c3032d85924ffac59))

## [2.0.1](https://github.com/INNERJOINT/Granada/compare/v2.0.0...v2.0.1) (2026-05-19)

### Bug Fixes

* **ci:** use GITHUB_TOKEN instead of PAT for release workflow ([e102368](https://github.com/INNERJOINT/Granada/commit/e102368778a356ace7270a3746f2acdc6457cd1f))
* **plugin:** remove sensitive flag from AOSP_MCP_KEY and add default value ([7af743c](https://github.com/INNERJOINT/Granada/commit/7af743c9a4cc84e31a2919a44fbcb8620d9643a1))

# Changelog

## [1.3.1](https://github.com/INNERJOINT/Granada/compare/v1.3.0...v1.3.1) (2026-05-18)


### Bug Fixes

* **ci:** find release PR by label instead of relying on empty output ([b7e7a6c](https://github.com/INNERJOINT/Granada/commit/b7e7a6c8ad91fdc1b04b9628ad3791838bb9007c))

## [1.3.0](https://github.com/INNERJOINT/Granada/compare/v1.2.2...v1.3.0) (2026-05-18)


### Features

* **ci:** auto squash-merge release PR with changelog body and label update ([1703f60](https://github.com/INNERJOINT/Granada/commit/1703f603eef03d6533fb719bdfe234995841dc95))

## [1.2.2](https://github.com/INNERJOINT/Granada/compare/v1.2.1...v1.2.2) (2026-05-18)


### Bug Fixes

* **ci:** include PR body as squash merge commit message ([1dcc7fd](https://github.com/INNERJOINT/Granada/commit/1dcc7fdce2d0aa4783d03302de42ade63d64819a))
* **ci:** simplify release workflow to standard release-please pattern ([e8f720d](https://github.com/INNERJOINT/Granada/commit/e8f720d15c897ffc69f296155b26214154b87de1))

## [1.2.1](https://github.com/INNERJOINT/Granada/compare/v1.2.0...v1.2.1) (2026-05-18)


### Bug Fixes

* **ci:** two-stage release workflow with sync-to-master before release-please ([2197115](https://github.com/INNERJOINT/Granada/commit/219711580a29acf28abe9a6c9e669a7d1bd77f86))

## [1.2.0](https://github.com/INNERJOINT/Granada/compare/zaku-v1.1.0...zaku-v1.2.0) (2026-05-18)


### Features

* switch MCP transport from stdio bridge to streamable HTTP ([290de35](https://github.com/INNERJOINT/Granada/commit/290de353068a4f61dbe0a6a67bc5aeed4b6641d6))


### Bug Fixes

* **ci:** delete release-please branch after merge ([254cc58](https://github.com/INNERJOINT/Granada/commit/254cc58f9a3930878c5afedb67c932825285e42e))
* **ci:** target dev branch for release-please and add auto-merge ([e9a07f7](https://github.com/INNERJOINT/Granada/commit/e9a07f79fad99a55e5364d57645fe7701408bb88))
* **ci:** trigger release-please on release branch and use repo default target ([52fcc15](https://github.com/INNERJOINT/Granada/commit/52fcc15d94854dd9ce34fa9d5b3956a3f4e4f03e))

## [1.1.0](https://github.com/INNERJOINT/Granada/compare/zaku-v1.0.1...zaku-v1.1.0) (2026-05-18)


### Features

* add release-please for automated version bumping ([2c2e63b](https://github.com/INNERJOINT/Granada/commit/2c2e63b00ec3703865045e094b803e570611f399))


### Bug Fixes

* **plugin:** mark userConfig fields as required to trigger enable-time prompt ([cbc888a](https://github.com/INNERJOINT/Granada/commit/cbc888a2e7fbf89d346faa0eab89d35cdc838b0e))
* **plugin:** remove invalid agents/skills manifest fields ([26dd6b4](https://github.com/INNERJOINT/Granada/commit/26dd6b4bc4ca9d5d3e71a7830bb44b25a19390f9))
