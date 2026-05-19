## [1.5.2](https://github.com/adobe/da-collab/compare/v1.5.1...v1.5.2) (2026-05-19)


### Bug Fixes

* **edge:** send() before close() to prevent CF runtime exception ([38f8b90](https://github.com/adobe/da-collab/commit/38f8b907ccf65499dae120449c74aace488c6816))

## [1.5.1](https://github.com/adobe/da-collab/compare/v1.5.0...v1.5.1) (2026-05-19)


### Bug Fixes

* **edge:** suppress CF "Network connection lost." exceptions on WS auth failures ([#155](https://github.com/adobe/da-collab/issues/155)) ([d7b5b59](https://github.com/adobe/da-collab/commit/d7b5b595310c78ba7f7665a1982d000981ab5847))

# [1.5.0](https://github.com/adobe/da-collab/compare/v1.4.2...v1.5.0) (2026-05-19)


### Bug Fixes

* preserve pending Yjs changes across DO evictions via lastsync CF storage marker ([#153](https://github.com/adobe/da-collab/issues/153)) ([defb16c](https://github.com/adobe/da-collab/commit/defb16c3479b8b703b49c8962ceb83c4bfe5b8f0))


### Features

* adopt Cloudflare WebSocket Hibernation API ([#137](https://github.com/adobe/da-collab/issues/137)) ([61e6000](https://github.com/adobe/da-collab/commit/61e6000db0bd101a45bac63c95dc8505008bbad3))
* WebSocket flush protocol for force-save before Preview/Publish ([#152](https://github.com/adobe/da-collab/issues/152)) ([8bf0ff4](https://github.com/adobe/da-collab/commit/8bf0ff4b391de25fb031ce823497bea074d8818e))

## [1.4.2](https://github.com/adobe/da-collab/compare/v1.4.1...v1.4.2) (2026-05-15)


### Bug Fixes

* **edge:** signal WebSocket auth failures with custom close codes ([#149](https://github.com/adobe/da-collab/issues/149)) ([5b192a9](https://github.com/adobe/da-collab/commit/5b192a9f730702c5cbd247ff7c21506cd63a381d))

## [1.4.1](https://github.com/adobe/da-collab/compare/v1.4.0...v1.4.1) (2026-05-13)


### Bug Fixes

* **docroom:** include docName in da-admin restore failure log ([#146](https://github.com/adobe/da-collab/issues/146)) ([779963d](https://github.com/adobe/da-collab/commit/779963d7adc278c4594a0674d3162768737d808c))

# [1.4.0](https://github.com/adobe/da-collab/compare/v1.3.0...v1.4.0) (2026-05-13)


### Features

* flush pending save on last WebSocket connection close ([#148](https://github.com/adobe/da-collab/issues/148)) ([27b5fc0](https://github.com/adobe/da-collab/commit/27b5fc0b3151c9e783bcefdc85818c7135272264))

# [1.3.0](https://github.com/adobe/da-collab/compare/v1.2.7...v1.3.0) (2026-05-13)


### Features

* add targeted session logging to diagnose content-loss ([#147](https://github.com/adobe/da-collab/issues/147)) ([f96ce19](https://github.com/adobe/da-collab/commit/f96ce19bc39af7916726e5c74e1af58022a01e4b))

## [1.2.7](https://github.com/adobe/da-collab/compare/v1.2.6...v1.2.7) (2026-05-13)


### Bug Fixes

* guard persistence.put against empty-stub overwrites (COR-31) ([#142](https://github.com/adobe/da-collab/issues/142)) ([037976a](https://github.com/adobe/da-collab/commit/037976ac47fcf6a82dca747bd59f2b555c525486))

## [1.2.6](https://github.com/adobe/da-collab/compare/v1.2.5...v1.2.6) (2026-05-12)


### Bug Fixes

* **docroom:** include docName in update-failure log ([#143](https://github.com/adobe/da-collab/issues/143)) ([0c130c5](https://github.com/adobe/da-collab/commit/0c130c5b6040088c1999b8f987e9bdbf2f38a539))

## [1.2.5](https://github.com/adobe/da-collab/compare/v1.2.4...v1.2.5) (2026-05-11)


### Bug Fixes

* guard debounced save against concurrent PUT calls ([#140](https://github.com/adobe/da-collab/issues/140)) ([3eba8af](https://github.com/adobe/da-collab/commit/3eba8af5e819525bd4809e82c6939a7189e259d2))

## [1.2.4](https://github.com/adobe/da-collab/compare/v1.2.3...v1.2.4) (2026-05-05)


### Bug Fixes

* demote expected platform events to info and eliminate unknown worker outcomes ([#135](https://github.com/adobe/da-collab/issues/135)) ([f72ff4b](https://github.com/adobe/da-collab/commit/f72ff4b33e6092863236672bb1d894022300f96e))

## [1.2.3](https://github.com/adobe/da-collab/compare/v1.2.2...v1.2.3) (2026-05-05)


### Bug Fixes

* avoid storage.deleteAll() in storeState to prevent Cloudflare DO reset bug ([#133](https://github.com/adobe/da-collab/issues/133)) ([4ebbddc](https://github.com/adobe/da-collab/commit/4ebbddc51048109ceb96e212d1d9397cdd9787ee))

## [1.2.2](https://github.com/adobe/da-collab/compare/v1.2.1...v1.2.2) (2026-05-05)


### Bug Fixes

* skip stale da-admin reload when client pushes Y.js state after reconnect ([#136](https://github.com/adobe/da-collab/issues/136)) ([a8ddc23](https://github.com/adobe/da-collab/commit/a8ddc23256f91e8e020b6d34ca5fdd6e39c37f45))

## [1.2.1](https://github.com/adobe/da-collab/compare/v1.2.0...v1.2.1) (2026-04-30)


### Bug Fixes

* propagate HTTP status from persistence.get through DocRoom.fetch response ([#134](https://github.com/adobe/da-collab/issues/134)) ([eac219d](https://github.com/adobe/da-collab/commit/eac219d553991b8de7e9ae2812a7508173a028f2))

# [1.2.0](https://github.com/adobe/da-collab/compare/v1.1.2...v1.2.0) (2026-02-26)


### Features

* collab for sheets release ([#130](https://github.com/adobe/da-collab/issues/130)) ([2d79326](https://github.com/adobe/da-collab/commit/2d7932670176611bdfcbfcb6370fc8de12864d8b))

## [1.1.2](https://github.com/adobe/da-collab/compare/v1.1.1...v1.1.2) (2026-02-18)


### Bug Fixes

* Update to da-parser 1.1.1 to fix alt and title encoding ([#128](https://github.com/adobe/da-collab/issues/128)) ([5cabe4b](https://github.com/adobe/da-collab/commit/5cabe4b543e769d3aad0da3c12d6a823eec8bd7d))

## [1.1.1](https://github.com/adobe/da-collab/compare/v1.1.0...v1.1.1) (2026-02-05)


### Bug Fixes

* make issues writable ([c7568b0](https://github.com/adobe/da-collab/commit/c7568b07a6d2d83836c2e66ee6777c2e9a488d9d))

# [1.1.0](https://github.com/adobe/da-collab/compare/v1.0.3...v1.1.0) (2026-01-06)


### Features

* add support for header authentication ([#120](https://github.com/adobe/da-collab/issues/120)) ([73b8895](https://github.com/adobe/da-collab/commit/73b889550a7e7e7d0c66e6be7d7aba3e793724a5))

## [1.0.3](https://github.com/adobe/da-collab/compare/v1.0.2...v1.0.3) (2025-12-09)


### Bug Fixes

* remove doc from cache if error ([#118](https://github.com/adobe/da-collab/issues/118)) ([911e81e](https://github.com/adobe/da-collab/commit/911e81e47d4e79075fb4e502dec4763eebe7df37))

## [1.0.2](https://github.com/adobe/da-collab/compare/v1.0.1...v1.0.2) (2025-12-08)


### Bug Fixes

* deploy to prod ([088a3d7](https://github.com/adobe/da-collab/commit/088a3d7bb1d9337b4a36d2f2fa34e738e407edbd))

## [1.0.1](https://github.com/adobe/da-collab/compare/v1.0.0...v1.0.1) (2025-12-08)


### Bug Fixes

* bindings ([e7a2baa](https://github.com/adobe/da-collab/commit/e7a2baa46494a817ff53241e567119091fcd4ed7))

# 1.0.0 (2025-12-08)


### Bug Fixes

* add check for shared secret ([#108](https://github.com/adobe/da-collab/issues/108)) ([a79731f](https://github.com/adobe/da-collab/commit/a79731f45439376ead2fc4710491d5d955727c2d))
* add span to known HTML tags ([#101](https://github.com/adobe/da-collab/issues/101)) ([fbf016d](https://github.com/adobe/da-collab/commit/fbf016d89ec041c5102c3dadaebdf3676501f37b))
* do not empty document if error ([#90](https://github.com/adobe/da-collab/issues/90)) ([a406add](https://github.com/adobe/da-collab/commit/a406adde80b78473be6e4484b9b0bf4a45b0b471))
* encode HTML brackets ([#100](https://github.com/adobe/da-collab/issues/100)) ([6c5b5fd](https://github.com/adobe/da-collab/commit/6c5b5fd1abca1a77a91d4db0220b722ca4645cd2))
* encode HTML brackets ([#74](https://github.com/adobe/da-collab/issues/74)) ([015163e](https://github.com/adobe/da-collab/commit/015163efd579c96490461d53a18b312adf1ab08d))
* keep content if no main found in html ([#85](https://github.com/adobe/da-collab/issues/85)) ([9fd25ac](https://github.com/adobe/da-collab/commit/9fd25ac890efedd9785e14e20043f3655a749f0e))
* null doc crashes aem2doc ([#84](https://github.com/adobe/da-collab/issues/84)) ([6197114](https://github.com/adobe/da-collab/commit/6197114c798ced86d1fd891e75001a3bede38570))
* ommit stacktraces in error map for non-dev ([#110](https://github.com/adobe/da-collab/issues/110)) ([1f896ac](https://github.com/adobe/da-collab/commit/1f896ac8aadd075566a593a1ab4d8a9d02dc78fe))
* remove html comments ([#68](https://github.com/adobe/da-collab/issues/68)) ([cf05aae](https://github.com/adobe/da-collab/commit/cf05aae98d5aa84e804b9603df979b7df47c7acf))
* trigger release ([ca061d4](https://github.com/adobe/da-collab/commit/ca061d43da27bea31d42bb7c8373cf7a441c113a))


### Features

* disable stack traces on production ([#109](https://github.com/adobe/da-collab/issues/109)) ([79c40bd](https://github.com/adobe/da-collab/commit/79c40bd2974233ab9f098e15bdf162da14a5a893))
* Prevent implicit document creation via If-Match header ([#105](https://github.com/adobe/da-collab/issues/105)) ([b33ae65](https://github.com/adobe/da-collab/commit/b33ae65311ea1ad1df394fc6f04cb3f14f387fc9))

# 1.0.0 (2025-12-08)


### Bug Fixes

* add check for shared secret ([#108](https://github.com/adobe/da-collab/issues/108)) ([a79731f](https://github.com/adobe/da-collab/commit/a79731f45439376ead2fc4710491d5d955727c2d))
* add span to known HTML tags ([#101](https://github.com/adobe/da-collab/issues/101)) ([fbf016d](https://github.com/adobe/da-collab/commit/fbf016d89ec041c5102c3dadaebdf3676501f37b))
* do not empty document if error ([#90](https://github.com/adobe/da-collab/issues/90)) ([a406add](https://github.com/adobe/da-collab/commit/a406adde80b78473be6e4484b9b0bf4a45b0b471))
* encode HTML brackets ([#100](https://github.com/adobe/da-collab/issues/100)) ([6c5b5fd](https://github.com/adobe/da-collab/commit/6c5b5fd1abca1a77a91d4db0220b722ca4645cd2))
* encode HTML brackets ([#74](https://github.com/adobe/da-collab/issues/74)) ([015163e](https://github.com/adobe/da-collab/commit/015163efd579c96490461d53a18b312adf1ab08d))
* keep content if no main found in html ([#85](https://github.com/adobe/da-collab/issues/85)) ([9fd25ac](https://github.com/adobe/da-collab/commit/9fd25ac890efedd9785e14e20043f3655a749f0e))
* null doc crashes aem2doc ([#84](https://github.com/adobe/da-collab/issues/84)) ([6197114](https://github.com/adobe/da-collab/commit/6197114c798ced86d1fd891e75001a3bede38570))
* ommit stacktraces in error map for non-dev ([#110](https://github.com/adobe/da-collab/issues/110)) ([1f896ac](https://github.com/adobe/da-collab/commit/1f896ac8aadd075566a593a1ab4d8a9d02dc78fe))
* remove html comments ([#68](https://github.com/adobe/da-collab/issues/68)) ([cf05aae](https://github.com/adobe/da-collab/commit/cf05aae98d5aa84e804b9603df979b7df47c7acf))


### Features

* disable stack traces on production ([#109](https://github.com/adobe/da-collab/issues/109)) ([79c40bd](https://github.com/adobe/da-collab/commit/79c40bd2974233ab9f098e15bdf162da14a5a893))
* Prevent implicit document creation via If-Match header ([#105](https://github.com/adobe/da-collab/issues/105)) ([b33ae65](https://github.com/adobe/da-collab/commit/b33ae65311ea1ad1df394fc6f04cb3f14f387fc9))
