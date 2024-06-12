<script lang="ts">
  import { NostrApp, UniqueEventList, Nostr } from "nosvelte";
  import { createRxForwardReq } from "rx-nostr";
  import "websocket-polyfill";

  // components
  import EEW from "./eew.svelte";

  const req = createRxForwardReq();
  const relays: string[] = ["wss://relay-jp.shino3.net", "wss://r.kojira.io"];
  const sorted = (events: Nostr.Event[]) => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
  };
  const first = (events: Nostr.Event[]) => {
    return events[0];
  };
</script>

<NostrApp {relays}>
  <UniqueEventList
    queryKey={[]}
    filters={[
      {
        kinds: [30078],
        "#d": ["eew_alert_system_by_shino3"],
      },
      {
        kinds: [30078],
        "#d": ["eew_alert_system_by_shino3_test"],
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
      <!-- <button class="btn btn-secondary info-button"> ？ </button> -->
    </div>
  </UniqueEventList>
</NostrApp>
