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
