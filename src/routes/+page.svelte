<script lang="ts">
  // import { NostrApp, UniqueEventList, Nostr } from "nosvelte";
  import { createRxNostr } from "rx-nostr";
  import { rxNostr } from "$lib/main";
  // import "websocket-polyfill";

  // components
  import EEW from "./eew.svelte";

  // const rxNostr = createRxNostr();
  const relays: string[] = ["wss://relay-jp.shino3.net", "wss://r.kojira.io"];
  rxNostr.setRelays(relays);

  // const sorted = (events: Nostr.Event[]) => {
  //   return [...events].sort((a, b) => b.created_at - a.created_at);
  // };
  // const first = (events: Nostr.Event[]) => {
  //   return events[0];
  // };
</script>

<!-- <NostrApp {relays}>
  <UniqueEventList
    queryKey={[]}
    filters={[
      {
        kinds: [30078],
        "#d": ["eew_alert_system_by_shino3"],
        // authors: [
        //   "npub1p92agfqsynk3lv8mturqwaq68wpvat55qsf72e3j97wkrnyy9hhsxczd3x",
        // ],
      },
    ]}
    {req}
    let:events
  >
    <div slot="loading">
      <p>Loading...</p>
    </div>

    <div slot="error" let:error>
      <p>{error}</p>
    </div>

    <div class="page">
      <EEW content={first(sorted(events)).content}></EEW>
      <button class="btn btn-secondary info-button"> ？ </button>
    </div>
  </UniqueEventList>
</NostrApp> -->
