## [1.0.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v1.0.0...v1.0.1) (2026-10-01)

### Bug Fixes

* **core:** data dir ([e0414d2](https://github.com/dont-be-evil-company/kulala.vscode/commit/e0414d282664844fc3ca74bc9b0a284f20823992))
* **docs:** package name ([07c7350](https://github.com/dont-be-evil-company/kulala.vscode/commit/07c7350a69fbb22d5c1c74e828e008e21ac78d7f))
* **package:** use "Kulala for Code" as display name ([4c46922](https://github.com/dont-be-evil-company/kulala.vscode/commit/4c4692223dccd1cb80fdf99affbd80200fc195b7))

## [1.0.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.13.0...v1.0.0) (2026-10-01)

### Features

* **streaming:** add streaming support and change orgs ([5694795](https://github.com/dont-be-evil-company/kulala.vscode/commit/5694795901dce2978e8648df52e90dec0ea9372b))
* **websocket:** add wait-for-server ([c857a90](https://github.com/dont-be-evil-company/kulala.vscode/commit/c857a9091793cae10ca1aa82eef1c44d48b1571e))

### Bug Fixes

* **ci:** changelog gen ([ddde760](https://github.com/dont-be-evil-company/kulala.vscode/commit/ddde7600f0763efebcc9bd52a5f453a3a2951bf7))
* **ci:** install node-gyp ([e94e6be](https://github.com/dont-be-evil-company/kulala.vscode/commit/e94e6be61d4e752e5410026aa954c7c7ebde5220))
* **ci:** up pnpm-lock and core version ([f317937](https://github.com/dont-be-evil-company/kulala.vscode/commit/f317937fe00d4145c47b63b7d1e4665f288f867f))
* **name:** rename to kulala-code ([795a565](https://github.com/dont-be-evil-company/kulala.vscode/commit/795a5659291d56f16cf3ce5195c0b380dbca3c25))

## [0.13.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.12.0...v0.13.0) (2026-08-18)

### Features

* **openapi:** add copy as http and load from file ([392a1d8](https://github.com/dont-be-evil-company/kulala.vscode/commit/392a1d8951f6fe61732c627c1a55512654c4e145))

## [0.12.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.11.0...v0.12.0) (2026-08-12)

### Features

* **grpc:** add support `@grpc-insecure` operator ([90e802d](https://github.com/dont-be-evil-company/kulala.vscode/commit/90e802dd78133b9299e409f695bcea0d7e16ca28))

## [0.11.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.10.0...v0.11.0) (2026-08-11)

### ⚠ BREAKING CHANGES

* **openapi:** openapi-json has been renamed to openapi-explorer

### Features

* **openapi:** extend script support for openapi-explorer ([527d0d6](https://github.com/dont-be-evil-company/kulala.vscode/commit/527d0d6dfe3efa3c386452d8c2d881deeb81cea5))

## [0.10.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.9.0...v0.10.0) (2026-08-10)

### Features

* **openapi,ui:** add openapi explorer + monaco editor for res ([32fa80e](https://github.com/dont-be-evil-company/kulala.vscode/commit/32fa80e63bbde5459445621220fe326f1dae6be9))
* **scripts:** add $kulala.request.abort() ([3cda9bf](https://github.com/dont-be-evil-company/kulala.vscode/commit/3cda9bfd3a6a0b5aba48651816a895e57b874a76))

## [0.8.2](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.8.0...v0.8.2) (2026-08-04)

### Features

* **scripts:** allow require/import of node packages in scripts ([8da721e](https://github.com/dont-be-evil-company/kulala.vscode/commit/8da721e872814fb4b312fbedf28f0f0d6805e7ed))
* **websockets:** add sender/receiver to body view ([54a7391](https://github.com/dont-be-evil-company/kulala.vscode/commit/54a7391070f0ad8ac63145710500a1c8113747ad))

### Bug Fixes

* **ci:** update pnpm ([d85c986](https://github.com/dont-be-evil-company/kulala.vscode/commit/d85c986c83376365333c6f7f19a6f1704bd77503))
* **tests:** fix websocket test to use correct testing framework ([e8f272f](https://github.com/dont-be-evil-company/kulala.vscode/commit/e8f272fbc40dca14c37ad024cc32e76004d34469))

## [0.7.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.7.0...v0.7.1) (2026-07-24)

### Bug Fixes

* **docs:** update CHANGELOG.md ([e064a68](https://github.com/dont-be-evil-company/kulala.vscode/commit/e064a68e5bca9bc3202d1ae6560e027851d1a0b8))

## [0.7.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.6.2...v0.7.0) (2026-07-24)

### Features

* **ui:** tree-sitter fixes enhancements comments ([6343016](https://github.com/dont-be-evil-company/kulala.vscode/commit/63430166537f0f57198ee21d321d1900442ec24f))

### Bug Fixes

* **graphql:** context with preambles ([46ef9ce](https://github.com/dont-be-evil-company/kulala.vscode/commit/46ef9ce504c8f6e22449cb72c142d76dcc1de63b))
* **operators:** request operators should always have precendence ([89bd0f9](https://github.com/dont-be-evil-company/kulala.vscode/commit/89bd0f9603acee17a16fa11e0e75006a26a52c21))

## [0.6.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.5.1...v0.6.0) (2026-07-07)

### Features

* **treesitter:** update treesitter to support kulala-jq syntax ([f2b0082](https://github.com/dont-be-evil-company/kulala.vscode/commit/f2b00826244fc220a3e9d19b637a33e0c6bc2e2f))

### Bug Fixes

* **scripts:** changelog generation script ([9d986a9](https://github.com/dont-be-evil-company/kulala.vscode/commit/9d986a91fa1bf149557dea2bc3430abc31304db4))

## [0.5.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.5.0...v0.5.1) (2026-07-03)

### Bug Fixes

* file corruption during binary uploads ([c0359c5](https://github.com/dont-be-evil-company/kulala.vscode/commit/c0359c5dbf1a1d4acf3be65bc191ec3974a467f3))
* **lint:** fix lint script ([4a3b9f8](https://github.com/dont-be-evil-company/kulala.vscode/commit/4a3b9f8bfeb9221b5c265dcbb2b387b9c6438cca))

## [0.5.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.4.3...v0.5.0) (2026-07-01)

### Features

* **changelog:** add changelog generation script ([016184b](https://github.com/dont-be-evil-company/kulala.vscode/commit/016184beb6364945dd18725dcdad815252182fb8))
* **env:** add support for ws (withsecrets.com) ([dfa10ae](https://github.com/dont-be-evil-company/kulala.vscode/commit/dfa10aeb2db42db42a16775449f2f947c70f44e3))
* **lsp:** add more operators to lsp completion ([834f181](https://github.com/dont-be-evil-company/kulala.vscode/commit/834f181b555e5e7a42099c306eac65471a8ef3ff))

### Bug Fixes

* **lint:** ignore changelog ([aea9b3e](https://github.com/dont-be-evil-company/kulala.vscode/commit/aea9b3e017820152afac89f4259180d522122e95))

## [0.4.3](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.4.2...v0.4.3) (2026-07-01)

### Bug Fixes

* **curl:** omit content-type header if not set by user ([ff23ddf](https://github.com/dont-be-evil-company/kulala.vscode/commit/ff23ddf4f0af716b2018566e468838005df75463))

## [0.4.2](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.4.1...v0.4.2) (2026-06-30)

### Bug Fixes

* **lsp:** completion too greedy ([eb5423c](https://github.com/dont-be-evil-company/kulala.vscode/commit/eb5423c9381a1b456a8ed7222bb64a61db0faac5))

## [0.4.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.4.0...v0.4.1) (2026-06-29)

### Bug Fixes

* **grpc, lsp, stdout:** grpc tls+verbose, lsp filter by name, await stdout ([3023c30](https://github.com/dont-be-evil-company/kulala.vscode/commit/3023c302eeb0eaa1c01fa86abc0577526af8e899))

## [0.4.0](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.3.1...v0.4.0) (2026-06-27)

### Features

* **runner, lsp:** auto-encode url + add lsp inlay_hints ([9cfef38](https://github.com/dont-be-evil-company/kulala.vscode/commit/9cfef38ad70beaca542a0eefbe5f92ac720bb8e4))

## [0.3.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.2.2...v0.3.1) (2026-06-27)

### Features

* **scripting:** add $kulala.runRequest similar to bruno scripting works ([171a886](https://github.com/dont-be-evil-company/kulala.vscode/commit/171a8866ff1627c3f7c3730814be3bbded84629b))

### Bug Fixes

* **ignore:** add .env to .vscodeignore ([50318ce](https://github.com/dont-be-evil-company/kulala.vscode/commit/50318ce24e726c73798d8365aa8641a748f752b6))
* **oauth:** browser-flow on windows ([91f8a5b](https://github.com/dont-be-evil-company/kulala.vscode/commit/91f8a5bfbaf4f857ee6debbcae394a366798292a))

## [0.2.2](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.2.1...v0.2.2) (2026-06-25)

### Bug Fixes

* **lint:** sync svelte first ([23f65b4](https://github.com/dont-be-evil-company/kulala.vscode/commit/23f65b4ffe963118931e1c8e106e4884f9afceea))
* **lsp, oauth:** fix lsp triggering oauth flow ([b2e4dba](https://github.com/dont-be-evil-company/kulala.vscode/commit/b2e4dbafe08858082f08690b227ce5714aa70547))

## [0.2.1](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.1.6...v0.2.1) (2026-06-24)

### Features

* **ui:** move to svelte and melt ([7748fc1](https://github.com/dont-be-evil-company/kulala.vscode/commit/7748fc143da174fbad93cdc5ba2185ec22379342))

### Bug Fixes

* **backend:** bump backend to fix crlf parser bug ([cca1389](https://github.com/dont-be-evil-company/kulala.vscode/commit/cca138943f87d88f9622d170b336061ededd25c2))
* **dx:** direnv ([b3b0c53](https://github.com/dont-be-evil-company/kulala.vscode/commit/b3b0c537181dc8dcd0b54d0b8b5d774b52fdd921))
* **lint:** fix cast uri to string ([b798bc8](https://github.com/dont-be-evil-company/kulala.vscode/commit/b798bc84a745772055f99b9c037cfe969c47d57c))
* **oauth2:** read client secret from private file ([c25f8ef](https://github.com/dont-be-evil-company/kulala.vscode/commit/c25f8ef76c789315b70ad87f30f761d7939287d2))
* **ui:** always show the last run request as active view ([dd28348](https://github.com/dont-be-evil-company/kulala.vscode/commit/dd283485b56ef02155168f2c1c63b9d79e9024f7))
* **webview:** css not loading in webview ([a9c7620](https://github.com/dont-be-evil-company/kulala.vscode/commit/a9c7620a6520655069afea1bf88ce46cce267242))

## [0.1.6](https://github.com/dont-be-evil-company/kulala.vscode/compare/v0.1.5...v0.1.6) (2026-06-19)

### Features

* **dx:** add direnv ([e2ab8cf](https://github.com/dont-be-evil-company/kulala.vscode/commit/e2ab8cf442f53ce134426f544a124e6ef3f700d3))

### Bug Fixes

* **backend:** backend parser stripped compat mode when importing files ([f124fb5](https://github.com/dont-be-evil-company/kulala.vscode/commit/f124fb5f2a65c6457cde36f66966265f3472348b))

## [0.1.5](https://github.com/dont-be-evil-company/kulala.vscode/compare/93c7bf02f8821ae8f316dc06e9f33b357b7b89b8...v0.1.5) (2026-06-19)

### Features

* **ci:** add ci ([498c310](https://github.com/dont-be-evil-company/kulala.vscode/commit/498c310511cec17ac50e9ea5484c1fe0d786f49c))

### Bug Fixes

* **build:** fix build for ms ([93c7bf0](https://github.com/dont-be-evil-company/kulala.vscode/commit/93c7bf02f8821ae8f316dc06e9f33b357b7b89b8))
* **envManager:** envManager was completely borked due to type mismatch ([0fb50fe](https://github.com/dont-be-evil-company/kulala.vscode/commit/0fb50fea986956af4acc07fb3be84a8b47c5fdf3))
* **operator:** prompt not always triggered when running all requests ([faaa71f](https://github.com/dont-be-evil-company/kulala.vscode/commit/faaa71f1b929900b55817ab4584bb5a81191fa61))
* **package:** update dependencies, add openvxs, and cursor support ([496713f](https://github.com/dont-be-evil-company/kulala.vscode/commit/496713f956dd13c71d06dbee6a847b71b2f1becd))
