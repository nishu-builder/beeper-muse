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

The build preserves bundled JavaScript legal comments. `LICENSE` and this notice
are included in the public archive. Dependencies are pinned in `package-lock.json`;
no executable code is fetched at runtime.

## Setup, development and legacy components

The setup converter uses [yaml](https://github.com/eemeli/yaml) under ISC; it is
not part of the browser runtime. [bbctl](https://github.com/beeper/bridge-manager)
is a separately installed Beeper tool under Apache 2.0 and is not bundled.

The legacy Go companion uses [mautrix-go](https://github.com/mautrix/go) and
[go.mau.fi/util](https://github.com/mautrix/util) under MPL 2.0,
[go-sqlite3](https://github.com/mattn/go-sqlite3) under MIT (SQLite is public domain),
and [golang.org/x/net](https://go.googlesource.com/net) under BSD 3-Clause.
Versions and transitive modules are pinned in `go.mod` and `go.sum`.
No modifications to mautrix-go are distributed here.

Other transitive and development dependencies retain the licenses and notices
supplied in their npm or Go module distributions. Build tools and the legacy Go
binary are not included in the current Chrome extension ZIP.
