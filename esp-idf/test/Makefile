# Host-side tests for the network-graph record.
#
#   make -C netgraph/esp-idf/test
#   make -C netgraph/esp-idf/test clean
#
# No ESP-IDF and no microReticulum: netgraph.cpp's record path — compose,
# encode, parse, resolve — is arithmetic over rnsd's tables, and stubs/ supplies
# just enough platform to link it. The rnsd tables themselves are stubbed as
# data the test writes, so a record can be built for any neighbourhood without a
# board. If this build starts needing a real IDF header, something that is not
# record logic has grown into the record path.
#
# RNS is reached across the workspace, at the flat sibling path a spangap
# workspace lays every straddle out on. rnsd.h is the real header for the same
# reason the tables are the real shape: a stub of it would prove nothing.
RNS      ?= ../../../rns/esp-idf

CXX      ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -O1 -g -Istubs -I../include -I$(RNS)/include -I$(RNS)/src -Wno-unused-parameter

MSGPACK_SRC := $(RNS)/components/microreticulum/src/MsgPack.h

all: run

# The REAL MsgPack.h, copied in beside the stub Bytes.h it needs. Copied rather
# than reached over an -I, because its own `#include "Bytes.h"` resolves against
# its directory first and would find the microreticulum one — which drags in
# ESP-IDF's allocator and the microStore codec. Refreshed every build, so this
# is the shipping file and not a fork of it.
stubs/MsgPack.h: $(MSGPACK_SRC)
	cp $< $@

netgraph_record_test: netgraph_record_test.cpp ../src/netgraph.cpp stubs/MsgPack.h \
                      ../include/netgraph.h $(RNS)/include/rnsd.h $(RNS)/src/rnsd_peers.h
	$(CXX) $(CXXFLAGS) -o $@ netgraph_record_test.cpp

run: netgraph_record_test
	./netgraph_record_test

clean:
	rm -f netgraph_record_test

.PHONY: all run clean
