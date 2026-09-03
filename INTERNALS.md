# netgraph — internals

The operator/user guide is [README.md](README.md): the evidence classes, the
record format, the community and the crawl, and what the window draws. This file
is the maintainer's half — the seams to rns, and the things that will bite.

## 1. What this straddle is allowed to assume about rns

netgraph is a client of rnsd like lxmf or nomad, and the whole of its coupling
is four things:

- **`rnsd.h`** — the path-table and neighbourhood walks (`rnsdNodesForEach`,
  `rnsdPeersForEach`, `rnsdHostedDestsForEach`, `rnsdIfaceWalk`), the Link and
  Channel API the crawl and the sync engine ride on, and the announce claim
  (`RNSD_CLAIM_NETGRAPH`).
- **`ports.h`** — `NETGRAPH_SYNC_PORT` and `NETGRAPH_REQ_PORT`. They live in
  rns because rnsd is what dispatches on them, in the same table as every other
  consumer's ports. Nothing here may allocate one.
- **`MsgPack.h`**, from rns's vendored µReticulum, for Reticulum's own
  remote-management request and its answers. `PRIV_REQUIRES microreticulum` in
  `esp-idf/CMakeLists.txt`: this is the only file that touches an mR type, and
  the header surface exposes none.
- **The `rnstransport.remote.management` aspect and the handlers behind it**,
  which are rnsd's. The response generators run inline on the rnsd task inside
  `Link::handle_request` — µR returns synchronously and there is nowhere to
  defer to — so they cannot live here. netgraph supplies only the policy:
  whether to serve, and who may ask. `rnsdRemoteManagementAllow` re-registers
  them, because each handler holds a *copy* of the allow list.

`rnsdIfaceRadius` is deliberately NOT in that list. It stays private to rns
(`rnsd_peers.h`); only `rnsdIfaceWalk` was promoted to `rnsd.h`, because only it
has a caller outside that straddle.

## 2. Optional in both directions

Nothing requires netgraph. A straddle that contributes to an `if` line gates
both the include and the call on `CONFIG_STRADDLE_NETGRAPH`, which the build
system emits for every staged straddle; iface-lora is the one doing it today.
The gate is also the integration cue the build system reads back out of the
source, so netgraph lands in that component's `REQUIRES` when it is staged and
falls out when it is not — there is no manifest edit on either side, and no list
of contributors to keep current.

The consequence to hold on to: **a build without netgraph must be a build where
nothing here is reachable, not one where it is present and idle.** Anything new
that reaches from another straddle into this one goes behind the same symbol.

## 3. Threading

Every store mutation happens on the netgraph task, which is therefore free to
read without the lock; the CLI reads from the cli task and takes it. Same
single-writer discipline as rnsd's directory.

The rnsd walks this straddle reads (`rnsdIfaceWalk` and friends) are lock-free
single-writer reads of tables only the rnsd task writes. Off that task they are
**advisory**: a name read while a slot is being recycled can be torn, and the
answer is right again the next time it is asked. That is fine for composing a
record, which is a snapshot by construction, and it is never state to act on.

## 4. Testing

`make -C esp-idf/test` builds and runs `netgraph_record_test`, which includes
`netgraph.cpp` whole — its builder, encoder and resolver are in an anonymous
namespace, which is right, and this is how a test reaches them anyway. The
platform is stubbed just far enough to link and rnsd's tables are written as
data, so a record can be built for any neighbourhood without a board.

Two things the Makefile does on purpose:

- **`rnsd.h` is the real header**, reached at `../../../rns/esp-idf/include` —
  the flat sibling path a spangap workspace lays every straddle out on. A stub
  of it would prove nothing: the tables have to be exactly the shape the builder
  reads, or the test is testing itself.
- **`MsgPack.h` is copied in beside the stub `Bytes.h`** rather than reached
  over an `-I`, because its own `#include "Bytes.h"` resolves against its own
  directory first and would find microreticulum's — which drags in ESP-IDF's
  allocator and the microStore codec. The copy is refreshed every build, so it
  is the shipping file and not a fork of it.

If this build starts needing a real IDF header, something that is not record
logic has grown into the record path.

## 5. Pitfalls

- **`NG_MAGIC` is `0xF5` because it is an invalid UTF-8 lead byte.** rnsd sniffs
  an announce's `app_data` for a display name, and a record that could be
  mistaken for text would put mojibake in every peer listing. rnsd checks every
  candidate for valid UTF-8 for the same reason. Do not pick a friendlier magic.
- **Records are unsigned**, and travel only over encrypted Links between
  community members. A member can fabricate, and a signature never prevented
  that — so a record must never be handed to a party that does not trust the
  whole community.
- **Configuration goes in a record; measurements do not.** The test for a field
  is whether a change to it deserves waking the whole mesh. A frequency does;
  an RSSI would keep every digest in the community permanently mismatched.
- **The record flood is built and mothballed.** The builder, store, resolver and
  Channel server all work; the push path and the sync beat that depends on it
  are commented out at their call sites, because a record per node per announce
  beat does not scale on LoRa. `netgraph sync <hash>` still runs an exchange by
  hand. Every such site says so — see `plans/netgraph.md`.

## Read next

- [README.md](README.md) — the design and the operator's guide.
- [rns/INTERNALS.md](../rns/INTERNALS.md) — rnsd's task model, the directory,
  and the remote-management handlers this straddle sets policy for.
- `plans/netgraph.md` — the design record, including what was mothballed.
