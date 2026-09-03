file(GLOB NETGRAPH_SRCS "src/*.cpp")

# Cross-straddle REQUIRES come through spangap_requires.cmake — spangap-core
# and rns (hard requires), plus anything staged that the code cues on.
include(${CMAKE_CURRENT_LIST_DIR}/spangap_requires.cmake)
idf_component_register(
    SRCS ${NETGRAPH_SRCS} ${SPANGAP_CONDITIONAL_SRCS}
    INCLUDE_DIRS "include" ${SPANGAP_CONDITIONAL_INCLUDE_DIRS}
    REQUIRES
        ${SPANGAP_REQUIRES}
        json  # cJSON: the access-list add form submits JSON
    PRIV_REQUIRES
        # MsgPack, for Reticulum's own remote-management request and answers.
        # rns vendors the fork and stages it as a nested sub-component; only
        # this file touches the mR types, so it stays private.
        microreticulum
)
