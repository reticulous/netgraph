# netgraph — the mesh as a picture

**netgraph** draws the network: one circle per node, one line per adjacency,
including adjacencies between two other nodes over a mesh this device is not
even on. It is a client of [rnsd](../rns) like any other — it reads that node's
path table and interface state, asks other nodes about theirs over Reticulum's
own remote-management service, and resolves the union into `netgraph.*` rows
that the browser window reads.

Nothing requires this straddle. A build gets it by asking:

```sh
spangap build reticulous/reticulous --with reticulous/netgraph
```

An interface straddle that contributes its configuration to its own `if` line
gates the call on `CONFIG_STRADDLE_NETGRAPH`, so a build without netgraph
compiles that away and nothing else changes.

## What this straddle owns

```
netgraph/
├── esp-idf/
│   ├── include/netgraph.h      the boot hook + the iface detail contribution
│   ├── src/netgraph.cpp        the record, the store, the resolver, the crawl,
│   │                           the sync engine and the served half
│   ├── test/                   host-side tests for the record (make -C esp-idf/test)
│   └── assets/lcd-icons/       launcher SVG (LCD tile + web dock)
└── browser/
    └── src/
        ├── modules/netgraph.ts        registers the dock app + its window
        ├── lib/netGraph.ts            netgraph.* rows as vertices + edges
        ├── lib/forceLayout.ts         where the vertices go (the one seam)
        └── panels/NetGraphWindow.vue  the NetGraph dock app
```

**What lives in rns and not here.** The ITS ports netgraph listens on
(`NETGRAPH_SYNC_PORT`, `NETGRAPH_REQ_PORT`) are in rns's `ports.h`, and the
announce claim it takes (`RNSD_CLAIM_NETGRAPH`) is in rns's `rnsd.h` — the same
place every consumer's are, because rnsd is what dispatches on them. rnsd also
holds the `netgraph.discovery` aspect in its name table, so a peer listing can
say what a hash means. None of that is netgraph's to move.

## Routing truth locally, remote management for the rest

```
crawl (on demand, one Link per node, never automatic):
  us → node   LINK → IDENTIFY → /path ["table", nil, 1] → /status [true] → CLOSE

sync (on demand, over one Reticulum Channel between two nodes):
  I → R   DIGEST        every (origin, seq) I hold
  R → I   RECORD_PART*  records I lack or hold older
  R → I   WANT          origins R lacks or holds older
  I → R   RECORD_PART*  those records
  both    DONE          then the initiator closes the channel
```

rnsd's neighbourhood tables ([rns README](../rns/README.md), "The
neighbourhood") say who *this* node can hear. netgraph turns that plus the path
table into a drawing, and fills in the rest by asking other nodes directly —
over Reticulum's own remote-management service, so it reaches stock
installations whose software we do not write, and serves them the same facility
in return. The result is resolved into node and link tables under `netgraph.*`
that the browser app, the display and any on-device logic read.

**The graph has two sources and no others.** What this node knows for free — its
path table and its interface state, which cost no protocol and no traffic and
change the drawing the moment they change. And what other nodes know when asked,
one Link per node, once per crawl, started by a human.

Everything below is [`esp-idf/src/netgraph.cpp`](esp-idf/src/netgraph.cpp).
The crawl is `rnsdLinkIdentify` + `rnsdLinkRequest`; the server half is
`rnsdDestListenRequests`; the sync path is `rnsdChannelOpen` and
`rnsdDestListenChannels`.

### The four classes of evidence

Every edge is one of four, and **line style states the class and nothing else**.
There is no style for "old": evidence expires and the line leaves.

| `ev` | where it comes from | the edge runs | drawn |
|---|---|---|---|
| `route1` | our path table, `hops == 1` | us → that node | solid, in the interface class's colour |
| `route2` | our path table, `hops == 2` | the `via` node → that node | thin, white, no colour |
| `heard` | the peer and node walks | us → that peer | dashed, class colour |
| `record` | a node's own self-report, over a sync Channel | origin → the cell's peer | solid, class colour |

`route2` gets no colour because our `iface` names the interface *we* transmit
on, not the one the via-node used — we do not know that hop's medium and must
not draw as though we did. Beyond two hops nothing is drawn at all: the
intermediate chain is not in our table, and hanging a node off the next hop
would assert an adjacency the data does not contain.

`heard` is defined as the peers routing does *not* cover — the nodes we could be
one hop from and are not, because a faster parallel link carries the route or
nothing has routed through them yet. It is the one class no third party will
ever report.

Precedence for the same adjacency, strongest first: `route1`, `route2`,
`record`, `heard`. One published row per `(a, b, cls)`, carrying the strongest
class held for it — a pair we both route to and hear is one line, not two.

**Records are never announced.** The builder, the store, the resolver and the
Channel server all work, but a record flooded per node per announce tick does
not scale on LoRa, so the push path and the sync beat that depends on it are
commented out at their call sites. `netgraph sync <hash>` still runs an exchange
by hand. See `plans/netgraph.md`.

### The rules that make it simple

- **One writer per record.** A record is one node's self-report *about itself*.
  No node ever writes into another's. "Newer seq wins" is the entire conflict
  story. A record is one evidence class among four, not the drawing's
  foundation.
- **Records are atomic wholes.** Ingest replaces everything held for an origin
  in one step — no partial update, ever. That is what makes unsigned
  re-serialization by a relay safe and lets a record's internal references stay
  record-scoped.
- **Records are unsigned.** They travel over encrypted Links between community
  members and carry no signature of their own. A member can fabricate, and a
  signature never prevented that — so a record must never be handed to a party
  that does not trust the whole community.
- **Configuration goes in a record; measurements do not.** Frequency, spreading
  factor, interface names, whether a link exists: yes. RSSI, SNR, negotiated
  budgets, counters: no. The test for a field is whether a change to it deserves
  waking the whole mesh.
- **A merely-heard peer is not a link.** A peer enters the link list only once
  an announce has been decoded from it — the same evidence that creates an rnsd
  peer row. The odd packet caught when the wind was right stays local.

### The community, and the crawl

**One keypair admits the whole community.** It is derived from a name and a
passphrase — `PBKDF2-HMAC-SHA256(s.netgraph.passphrase, "netgraph-community:" ‖
s.netgraph.community)`, 64 bytes read as X25519 ‖ Ed25519 — so every node that
knows both derives the same identity, with nothing exchanged and nothing
per-peer to configure. The derived key lands in `secrets.netgraph.identity` and
is what `rnsdLinkIdentify` is handed when we crawl; the community hash is what
this node's own allow list is seeded with. The passphrase is an ordinary
setting, not a secret: every node in the community holds it, and hiding it from
the operator who has to type it into the next node buys nothing. It is the
community's *access credential* rather than a network name — anyone holding it
can query every node that trusts it.

The community key **identifies, never addresses**. Building the management
destination on it would give every node the same address, and a management query
is always about one specific node.

**The management announce carries membership, encrypted or not at all.** With a
community configured, this node's `rnstransport.remote.management` announce
carries `issued ‖ flags ‖ name ‖ signature` encrypted to the community identity:
every member can read it because every member holds that private key, and nobody
else can. The signature is what proves membership — encryption alone would not,
since anyone holding the community *public* key can mint a token. Without a
community there is no app_data at all; the node is still perfectly askable,
because the allow list and not the announce is what grants anything. Stock
clients ignore app_data on this destination either way.

**The device's name lives here because this is the only place it can.** A
device's name belongs to the device, and the only address that *is* the device is
its node identity — which is what this destination is built on (rnsd relays
under a separate transport identity, which owns no destinations). An LXMF
display name belongs to a person, on a different identity. A community-less
deployment therefore draws a graph of hex, and that is the price of the rule.

**A crawl happens when a person asks and at no other time.** `netgraph crawl`,
or the button in the browser panel: no timer, no boot pass, no refresh-on-idle.
It gathers the nodes whose management announce we hold, visits each once in
distance order out to `s.netgraph.radius`, and extends the queue with what each
one's own `route1` answers reveal. A refusal or a timeout is normal and quiet —
it counts, and the pass moves on. This is pull traffic over somebody else's
airtime, and a device that quietly re-reads a neighbour's tables on a schedule is
what gets its hash removed from an allow list.

### The record

The pipe-text form below **is** the specification; the packed wire form is a
mechanical tokenization of it — same lines, same fields, same order.

```
n|Kitchen T-Deck|t
dt|3|a1b2c3d4 9f3e2a11 77ab01cd
if|lora|lora/0|868.5|7|125|5|s
ln|lora/0|37|9f3e2a11.0.t 8ab2c3d4.1 7c1d99f0.2 …
if|tcp|tcp_in/10.0.0.4#0
ln|tcp_in/10.0.0.4#0|1|55aa66bb.0.t
```

- `n` — what this node calls itself (may be empty) and its flags; `t` means it
  is an RNS transport node. The name is the device's hostname, falling back to
  the LXMF display name where no hostname is set — a vertex here is a device,
  and the hostname is the name its operator gave that device. `|`, newline and
  control characters become spaces when the record is built, which is the whole
  escaping story: a consumer may split on `|` unconditionally.
- `dt` — this node's own announced destination hashes, as 4-byte prefixes. This
  is the **join evidence**: another record's `ln` cell naming one of these is a
  link to this node.
- `if` — one per interface: the class word behind the status-line pill, the
  registered instance name, then class-owned configuration fields, opaque to
  everyone but that class's straddle and rendered verbatim.
- `ln` — the links on one interface, referenced by interface **name**, never by
  position. Second field is the TRUE link count; then at most K cells (all of
  them in the full record, the freshest K in an announce). A cell is
  `prefix.freshbucket[.t]` — the peer's 4-byte destination prefix, a freshness
  bucket relative to the record's own timestamp (0 ≤ 5 min, 1 ≤ 1 h, 2 ≤ 6 h,
  3 older), `t` for a transport node. Only peers that have announced get a cell;
  one known solely by its transport address is counted and not listed, because
  no other node could join it to anything anyway.
- `up` — a way OUT of the community: `up|<class>|<iface>|<address>`, one per
  radius-0 point-to-point interface whose far end rnsd has named. **The
  service radius is not a display filter** — it says how far to go looking for
  nodes to *serve*, where to stop reaching, and nothing about what is worth
  drawing. It is used here only to decide what the far end IS: rnsd keeps no
  peer rows for a radius-0 interface, so there can never be destination-level
  evidence about what is over there and it can only ever be an address. That
  earns it a box rather than a member circle — but it is drawn either way, and
  anything this misses (more uplinks than a record can carry, say) reaches the
  graph through the local overlay instead. It gets a line
  of its own rather than an `ln` cell, because an `ln` cell means "a community
  peer, joinable by its destination prefix" and an uplink is the opposite of
  that — no prefix, no record, ever. Keeping the two apart is what stops a
  resolver trying to join the outside world to a member. rnsd already takes this
  position: it declares a node for such an interface regardless of the radius,
  because *whether we serve a peer's mesh is a policy; that there is somebody at
  the other end of the wire is a fact*.
- Detail lines (`lora|if|lora/0|…`) — class-owned extra lines, scoped by
  reference to an `if`. None are defined today; the rule exists so a straddle
  can add one without touching core code, and so a node that does not know the
  class still carries the line intact.
- Exactly two separator levels below the field, ever: space for list cells, `.`
  for subfields within a cell. Nothing nests further.

Forward tolerance is structural rather than negotiated: an unknown first field
is skipped and carried verbatim, and unknown trailing fields on a known line are
ignored. There are no capability bits and no schema version — all community
nodes flash together.

The packed form is `magic 0xF5 | origin:16 | seq:u32 LE | flags:u8`, then
repeated `len:u16 LE | tag:u8 | body` where `len` counts the tag and body
together, so one number skips a line whether or not its tag is understood.
Everything count-dominant is binary; the one-off descriptive fields (`if`
parameters, detail lines) stay UTF-8 text even packed, so expanding a record
back to text needs no per-medium decoder anywhere. `0xF5` is an invalid UTF-8
lead byte on purpose: nothing that sniffs announce `app_data` for a display name
can mistake a record for one.

`seq` doubles as the record's build timestamp — device unix seconds, guarded
monotonic and persisted, so a reboot with a bad clock cannot re-issue an old seq
and have the community reject the node's own news about itself.

### What each node publishes

Under `netgraph.*` (ephemeral, so browser-synced automatically), written inside
one `storageBegin`/`storageEnd` bracket so a reader sees one coalesced patch:

```
netgraph.self                own identity hash, hex
netgraph.radius              service radius in force
netgraph.nodes.slots         walk bound
netgraph.nodes.<i>.id        identity hash hex ("" = known only by address)
netgraph.nodes.<i>.name      display name (may be "")
netgraph.nodes.<i>.label     transport-address label where there is no name
netgraph.nodes.<i>.transport 0/1
netgraph.nodes.<i>.dist      hops from us; 0 = us, EMPTY = nothing joined it up
netgraph.nodes.<i>.member    1 = its management announce carried a community signature
netgraph.nodes.<i>.visited   unix seconds of the last crawl visit, 0 = never
netgraph.links.count
netgraph.links.<j>.a         node slot of the reporting side
netgraph.links.<j>.b         node slot of the peer, -1 unresolved
netgraph.links.<j>.bref      peer prefix hex, when b = -1
netgraph.links.<j>.ev        route1 | route2 | heard | record
netgraph.links.<j>.cls       interface class word ("lora"); "" for route2
netgraph.links.<j>.iface     reporting side's interface name
netgraph.links.<j>.age_s     seconds since refreshed, EMPTY where undated
netgraph.links.<j>.transport 0/1 (peer side, as reported)
netgraph.links.<j>.src       crawled node's hash; "" for our own evidence
netgraph.ifs.<i>.count       interface lines node <i> reports
netgraph.ifs.<i>.<k>.cls/.name/.detail
netgraph.crawl.state         idle | running
netgraph.crawl.req           written by a client to start a crawl
```

`src` is there because `a` cannot answer "whose statement is this". `a` is the
reporting side, and for `route2` the reporting side is the via-node even when we
derived the row from our own path table — so a local `route2` and one the crawl
pulled out of that same neighbour would otherwise publish identically. They are
different claims: one is our table, the other is a third party's answer, asked
once and stale from the moment it landed.

`dist` and `age_s` are text so they can be EMPTY. An integer cannot say "no
answer" for either — `0` already means "us" and "this second".

Both directions of an adjacency are published — they are two separate
statements, not one fact written twice, and until the far end has reported the
reverse we know how one end reaches the other and not how it gets back. A
*renderer* merges them into one line where both rows exist and **stops short of
the far circle** where only one does; the rows keep them apart, which is what
lets it. An edge whose far end names a destination nothing claims is kept as a
**pending edge** (`b` = -1) rather than dropped, so a node's degree stays honest
while whatever would name the other end is still missing.

### An interface contributes its own fields

[`netgraph.h`](esp-idf/include/netgraph.h) exposes `netgraphContributeIface(cls,
cb)`. At rebuild the builder calls the class's callback to fill the class-owned
tail of its `if` line — pipe-separated text, configuration only. iface-lora
registers one and supplies frequency, spreading factor, bandwidth, coding rate
and whether SUPE is on. A straddle never sees a record: it contributes fields
and the builder composes, which is the `rnsdPillSet` relationship one layer up.

The contributing straddle gates its call on `CONFIG_STRADDLE_NETGRAPH`, which
the build system emits for every staged straddle. That is what keeps netgraph
optional in both directions: a build with it gets the fields, a build without it
compiles the callback and the registration away, and neither side needs a
manifest edit.

## NetGraph — the community as a picture

A dock app in this straddle's browser half
([`browser/src/panels/NetGraphWindow.vue`](browser/src/panels/NetGraphWindow.vue)):
one circle per node, **one line per
adjacency** — including adjacencies between two other nodes, over a mesh this
browser is not on. It draws `netgraph.*` and nothing else; every join behind the
picture happened on the device, which is the only place that holds the path
table, the interface state and whatever the crawl brought back.

**Nothing is pinned, and this device is the red circle.** A community graph has
no natural centre. Pinning the viewing node to the middle drags the rest into
whatever shape that leaves — a node at the end of a chain lands inside a
triangle of its own neighbours, which is a picture of the pin rather than of the
network. Where you are is said by colour instead, which costs the layout
nothing.

Two more things it does that a plain node-link drawing does not, and the reason
for each:

- **Lines take the medium's colour** — the same `rns.pill.<class>.color` its
  status-line pill uses, read live, and the legend names it with the
  `rns.pill.<class>.title` published beside it. One vocabulary for
  "which medium" on every surface, and no palette and no table of media in the
  app. This is why a colour is published from boot rather than from the moment
  its medium is switched on: a LoRa link between two other nodes is still a LoRa
  link on a node whose own radio is off, and drawing it in the fallback grey
  would say something false about the network. An interface straddle publishes
  its own entry; LoRa's comes from `rnsd`, because the radio straddle is staged
  only by a board that carries a modem and the graph on a radioless board draws
  the community's LoRa links all the same.
- **Parallel links are parallel arcs.** A peer reachable over both LoRa and
  Bluetooth is a peer that stays reachable, and that is the interesting fact on
  a mesh; one line between the circles would hide exactly it. The bundle between
  a pair is collected first and the curvatures spread symmetrically about where
  the straight line would have been, so one link is straight and two bow either
  side.

**Line style is the evidence class and nothing else.** Solid in the medium's
colour is a route one hop out; thin and white is a route two hops out, hanging
off the neighbour it sits behind; dashed is a peer an interface hears that
routing does not use. Nothing is styled by age — evidence that expired was
removed by the device rather than dimmed by the app, so what is drawn is current
by construction. The legend names each style in words, because they are not
self-explaining, and so does the hover text: "1 hop, radio0", "2 hops — medium
unknown", "heard on radio0, not routed".

**An unreciprocated edge stops short.** A link between two nodes arrives as two
rows, one from each end. Where both are present they merge into one line that
touches both circles. Where only one is, the line is drawn from the reporting
end and stopped a vertex-radius short of the far one, with no arrowhead: the gap
says "this is how `a` gets there; how `b` gets back is not known". That is the
visible half of the invariant — we never draw a return path nobody told us
about.

A second ring around a circle is a transport node, which is the one property
that changes what the graph *means*: an edge through it reaches further than
itself. A small hollow circle with no caption is a **stub**: the far end of an
edge nothing has named yet, drawn so the degree of the node reporting it stays
honest. A stub cannot report, so an edge to one never stops short — that would
read as a fault rather than as the definition it is.

**The crawl button, and nothing else, starts a crawl.** It is pull traffic over
somebody else's airtime; there is no timer behind it, no boot pass and no
refresh-on-idle. The caption names the radius it will go to.

**Captions look for a clear spot.** Straight under the circle is where a caption
belongs, but on a graph that is the busiest space on the canvas — every line to
the node converges there. So each label is tried in a ring of eight spots
(below, above, the sides, the diagonals) against the sampled edge curves, the
other circles, the canvas edge and the captions already placed, and takes the
first that is clear. The spots are measured from the outermost thing drawn at
the vertex, so a transport node's caption clears its second ring rather than
brushing it. One with nowhere clear to go keeps the conventional spot
and is drawn on a black knockout instead: a dense graph genuinely has no clear
spot, and moving a caption far enough to find one makes it read as belonging to
a different circle.

**Crossings are minimised, not left to chance.** A spring embedder has no term
for them and cannot grow one — whether two edges cross is a property of the
whole drawing, not a force between two vertices — so three connected nodes plus
one outlier would put the outlier on whichever side its starting angle chose,
and half the time its single edge cut straight through the triangle. So the
springs settle the shape and then an untangling pass relocates one vertex at a
time to whichever position around its neighbours crosses fewest edges, retrying
from a different starting arrangement while a fault survives. It is a local
search, so it does not guarantee a flat drawing of every graph that has one, but
it clears the shapes a neighbourhood actually makes.

**Wide angles where there is a choice.** Below the two faults, the search
prefers the arrangement whose narrowest fan of edges at any vertex is widest —
which is what stops a triangle being drawn as a sliver that reads as one line
rather than three. An angular-resolution *force* was tried for this and removed:
gentle, it barely moved the worst angle; strong enough to matter, it fought the
springs into new crossings and drove the worst angle to zero. The search reaches
~55° where the force reached ~9°, and costs no crossings to do it, because it
can refuse a move that breaks something a force can only shove at.

**Even lengths where nothing else decides.** A 200 px line beside a 40 px one
reads as a statement about distance, and nothing in a record is a distance — so
evenness is the honest default, and a chain of nodes comes out as a chain of
equal links. Two mechanisms: a relaxation pass pulls every edge toward the
drawing's mean length, half the correction at each end, moving only along the
edge so the shape the springs settled on is not rotated; and evenness is the
last of the four ranking criteria, below every fault and below the angles, so
the untangler prefers the arrangement whose lines most nearly agree. The pass
runs before the untangler and again after it — relocating a vertex is exactly
what leaves one edge long and one short — with the second run reverted if it
would cost a crossing or put an edge through a circle.

**The frame follows the window.** The layout runs in fixed graph units, but the
viewBox is the drawing's own bounds grown to the panel's shape, so the picture
fills the window and keeps filling it through a resize without the simulation
re-running and the vertices jumping under the hand doing the resizing. It stops
shrinking below a floor: a two-vertex community has bounds a few tens of units
across, and a frame that tight would blow its captions up into headlines.

**An edge never passes through a circle.** That is ranked above crossings and is
the one thing the layout will spend crossings to avoid. Two edges crossing is a
drawing that could be clearer; an edge running through a node it does not end at
is a drawing that is *wrong* — it reads as a connection that is not in the data,
and no amount of looking tells the reader otherwise. It is also exactly what a
crossings-only search reaches for, since flattening a triangle onto a line is a
cheap way to stop its edges crossing anything. The clearance comes from the
drawer, which is the half that knows how big a circle is.

`browser/src/lib/netGraph.ts` reads the rows, `panels/NetGraphWindow.vue` is the
drawing, and `lib/forceLayout.ts` is the one seam — small enough to carry inline
for a graph this size, replaceable by a layout library without touching anything
else.


## Storage variables

### Settings (read)

| Key | Default | Meaning |
|---|---|---|
| `s.netgraph.enable` | `1` | Run the distributed network graph. Live — a change starts or stops the component and takes the `netgraph.*` rows down with it. |
| `s.netgraph.community` | *(empty)* | The community's name. With `s.netgraph.passphrase` it derives the community keypair; empty means no community — the node serves and draws, and announces no membership. |
| `s.netgraph.passphrase` | *(empty)* | The community's passphrase. An ordinary setting rather than a secret: every node in the community holds it, and the *derived* key is what lives in the secrets tier. Changing either re-derives, re-pushes the allow list and re-airs the membership announce. |
| `s.netgraph.serve` | `1` | Answer `/path` and `/status` on the stock management address. Only the community and the identities below may ask; an unidentified request is refused. |
| `s.netgraph.allow.<i>.{id,hash}` | — | Identity hashes allowed to query this node besides the community, as a collection the settings pane binds rows to. Same form as stock `remote_management_allowed`, so a line copies straight across either way. Written only through the `netgraph.allow.add`/`.remove` command keys, which is why no UI parses a hash. |
| `s.netgraph.radius` | `2` | How many hops out a crawl goes. |
| `s.netgraph.crawl_timeout_s` | `20` | How long one visit may take before the crawl gives up on that node and moves to the next. |
| `s.netgraph.heard_h` | `3` | Evidence unheard for this long leaves the drawing. Lines are removed rather than dimmed: everything on the picture is current. |
| `s.netgraph.rebuild_floor_s` | `600` | Minimum seconds between rebuilds of this node's own record. The floor is what stops a node joining a busy neighbourhood from re-flooding its record once per neighbour: a burst of changes coalesces into one rebuild. |
| `s.netgraph.announce_cells` | `8` | Record path (records are never announced — the settings from here down configure a subsystem that is built and mothballed). Maximum link cells per `ln` line in the ANNOUNCED form. Fewer are used automatically if the record still will not fit the airtime budget; the full record always carries all of them. |
| `s.netgraph.link_horizon_h` | `6` | A link not heard for this long leaves the record. A neighbour currently attached but never heard from is not stale — its lifetime is the interface's statement that it is reachable. |
| `s.netgraph.horizon_h` | `24` | Records older than this are dropped, never stored, and never offered in a digest. Half of it is the point at which a node is published as `stale`. |
| `s.netgraph.sync_min` | `30` | Anti-entropy ceiling in minutes: one Channel exchange against one rotating neighbour. The interval is adaptive between 30 s and this — an exchange that taught this node nothing doubles it, one that brought a record halves it — and it counts exchanges a NEIGHBOUR initiated too, since being visited answers the same question as visiting. Each wait is shortened by up to a quarter at random, so nodes that back off together do not end up dialling in lockstep. |
| `s.netgraph.store_kb` | `24` | Byte cap on the record store. Over it, the stalest-received record goes first; our own is never evicted. RAM only — a rebooted node backfills faster than flash-wear accounting would be worth. |

### Runtime state & telemetry (written)

| Key | Meaning |
|---|---|
| `netgraph.{self,radius,nodes.*,links.*,ifs.*}` | The network graph, resolved from the four classes of evidence ("What each node publishes", above). Taken down wholesale when the component stops. |
| `netgraph.crawl.state` | `idle` or `running`. The browser's crawl button reads this rather than tracking a local flag, so a crawl started from the CLI or another browser disables it everywhere. |
| `netgraph.community.id` | The derived community identity hash, published only once a key exists — the row an operator who has just typed a passphrase is watching for. It is also what a node outside the community is asked to allow. |
| `netgraph.allow.{done,error}` | Acknowledgement counter and the rejection sentence the add form shows. |
| `s.netgraph.seq` | State, not a setting: the last sequence number this node issued for its own record. Persisted so a reboot with a bad clock cannot re-issue an old one. |

### Command keys (read, self-clearing)

Same convention as rnsd's: write a value and the netgraph task consumes it.
`netgraph.crawl.req` is a rising value rather than a flag — two crawls in a row
must both be seen — and `netgraph.allow.add` / `netgraph.allow.remove` are the
only writers of the allow collection, which is why no UI parses a hash.

### Secrets

`secrets.netgraph.identity` — the 128-hex private key derived from the community
name and passphrase. Derived rather than generated, so it is reproducible on
every node that knows both; deleting it costs nothing but the derivation.

## CLI

```
netgraph                          record store: origins, seqs, ages, bytes, sync state
netgraph d[ump] [<prefix>]        records expanded to pipe text
netgraph l[inks]                  the resolved graph — what is drawn
netgraph m[embers]                who announced management, and what they said
netgraph c[rawl] [<hash>]         visit the community, or one node
netgraph s[ync] <hash>            run a record exchange by hand
netgraph r[ebuild]                rebuild our own record
```

Run any of these on-device through `spangap cli "<command>"`.

## Tests

```sh
make -C esp-idf/test
```

The record path — compose, encode, parse, resolve — is arithmetic over rnsd's
tables and exactly the part a device cannot show you: a node draws circles and
no lines, and nothing on the wire says whether the builder emitted no cells, the
encoder mislaid them, or the resolver failed to join them. So the platform is
stubbed just far enough to link, rnsd's tables are stubbed as data the test
writes, and the record path itself runs for real. `rnsd.h` and `MsgPack.h` are
the shipping files, reached across the workspace at `../../../rns/`.

## Dependencies

- [rns](../rns) — rnsd: the path table, the interface walk, links, Channels,
  requests, and the announce claim. netgraph is a client of it like lxmf or
  nomad, and adds nothing to its surface.
- [spangap-core](../spangap-core) — base runtime (ITS, storage, log, CLI).

## What it does NOT own

- The neighbourhood tables it composes from — those are rnsd's, and a medium
  added tomorrow reaches this graph without a line of code here.
- Any interface's configuration. A straddle contributes FIELDS through
  `netgraphContributeIface`; the builder composes the line.
- Reticulum's remote-management wire format — that is Mark Qvist's, which is
  the point: it reaches stock installations, and serves them in return.

## Read next

- `plans/netgraph.md` — the design, and what is built but mothballed.
- [rns/README.md](../rns/README.md) — rnsd, the neighbourhood tables, and the
  remote-management service both halves of this ride on.
