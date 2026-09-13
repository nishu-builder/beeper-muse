# Third-party notices

Original code in this repository is licensed under MIT; see [LICENSE](LICENSE).
Dependencies retain their own licenses. They are fetched from the versions pinned
in `go.mod`, `go.sum`, and `package-lock.json`, rather than vendored here.

The bridge uses [mautrix-go](https://github.com/mautrix/go), copyright its
contributors, under the Mozilla Public License 2.0. Its source, including the
bridgev2 framework and Go Olm implementation, is available from that project at
the version in `go.mod`. No modifications to mautrix-go are distributed here.
See its [license](https://github.com/mautrix/go/blob/main/LICENSE).

Other direct Go dependencies are [go-sqlite3](https://github.com/mattn/go-sqlite3)
(MIT, with SQLite in the public domain) and [go.mau.fi/util](https://github.com/mautrix/util)
(MPL 2.0), plus [golang.org/x/net](https://go.googlesource.com/net)
(BSD 3-Clause) for parsing and sanitizing HTML. The setup wrapper uses [yaml](https://github.com/eemeli/yaml) (ISC).
Transitive and development dependencies retain the notices supplied in their
module or npm distributions.

[bbctl](https://github.com/beeper/bridge-manager) is a separately installed
Beeper tool under Apache 2.0. Its executable is not included in this repository.
Beeper, Meta, and Muse names identify the services used; this is an independent
project and does not imply endorsement.
