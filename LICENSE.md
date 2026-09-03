# License

This repository, **netgraph** (the mesh as a picture: this node's own routing
and interface truth, Reticulum's remote-management service crawled node by
node, and the NetGraph dock app that draws the result), is released under the
**Apache License, Version 2.0**.

Full license text: <https://www.apache.org/licenses/LICENSE-2.0>

Copyright (c) 2026 by reticulous project contributors.

## Third-party software

### Vendored in this repository

None. The force-directed layout and the crossing-reduction search behind the
drawing (`browser/src/lib/forceLayout.ts`) are original to this repository, and
so is everything under `esp-idf/`.

### Build-time dependencies

Declared in `esp-idf/idf_component.yml` and `browser/package.json`:

| Component / package | Source | License |
|---|---|---|
| ESP-IDF (platform) | espressif/esp-idf | Apache-2.0 |
| cJSON (`json`, ESP-IDF component) | ESP-IDF | MIT |
| Browser peer deps (Vue, Quasar, Pinia) | npm | MIT |

The MsgPack implementation this straddle encodes remote-management requests and
answers with is **microReticulum's**, vendored and licensed in
[rns](../rns/LICENSE.md) — a hard `requires:` of this straddle, which stages it
as a nested sub-component. Nothing is copied here.
