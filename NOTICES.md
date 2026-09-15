# Third-party notices

Original Beeper Muse code and geometric M artwork are MIT licensed; see
[LICENSE](LICENSE). Service names identify compatibility and do not imply Beeper
or Meta endorsement.

## Shipped Chrome extension

The bundle includes [`@matrix-org/matrix-sdk-crypto-wasm`](https://github.com/matrix-org/matrix-sdk-crypto-wasm)
18.8.0, including JavaScript bindings and its Rust/WASM encryption module, under
Apache License 2.0. The public archive includes its full license as
`MATRIX-CRYPTO-LICENSE`. Upstream source and dependency notices are available in
that project. No modifications to that dependency are distributed here.

The HTML formatter bundles [parse5](https://github.com/inikulin/parse5) 8.0.1
under MIT and its [entities](https://github.com/fb55/entities) dependency under
BSD 2-Clause. Their full licenses ship as `PARSE5-LICENSE` and `ENTITIES-LICENSE`.
No modifications to those dependencies are distributed here.

The build preserves bundled JavaScript legal comments. `LICENSE` and this notice
are included in the public archive. Dependencies are pinned in `package-lock.json`;
no executable code is fetched at runtime.

## Setup and development tools

The setup converter uses [yaml](https://github.com/eemeli/yaml) under ISC; it is
not part of the browser runtime. [bbctl](https://github.com/beeper/bridge-manager)
is a separately installed Beeper tool under Apache 2.0 and is not bundled.

Other transitive and development dependencies retain the licenses and notices
supplied in their npm distributions. Build and setup tools are not included in
the Chrome extension ZIP.
