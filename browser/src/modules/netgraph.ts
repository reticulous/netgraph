import { ref } from 'vue'
import { registerApp } from 'spangap-browser/lib/apps'
import { registerWindowMount } from 'spangap-browser/lib/windowMounts'
import NetGraphWindow from '../panels/NetGraphWindow.vue'

/* FloatingWindow restores its own saved visibility on mount and emits it back;
 * the focus nonce is what raises an already-open window from the dock. */
export const netGraphVisible = ref(false)
export const netGraphFocus = ref(0)
export function showNetGraph() {
  netGraphVisible.value = true
  netGraphFocus.value++
}

export function registerNetgraph() {
  /* Dock app: NetGraph — the mesh drawn from the device's own routing and
   * interface state plus whatever a crawl brought back, one circle per node and
   * one line per link, in the media's own status-line colours. Self-mounts its
   * window, so no buildable edit. */
  registerApp({ id: 'netgraph', label: 'NetGraph', icon: 'netgraph', placement: 7,
                open: showNetGraph, isOpen: () => netGraphVisible.value })
  registerWindowMount({ id: 'netgraph', title: 'NetGraph', component: NetGraphWindow,
                        visible: netGraphVisible, focusToken: netGraphFocus })
}
