<script lang="ts">
  import { NostrApp, UniqueEventList, Metadata, Nostr } from "nosvelte";
  import { createRxForwardReq } from "rx-nostr";
  import "websocket-polyfill";

  // components
  import EEW from "./eew.svelte";

  const req = createRxForwardReq();
  const relays: string[] = ["wss://relay-jp.shino3.net", "wss://r.kojira.io"];
  const sorted = (events: Nostr.Event[]) => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
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

    <div>
      {#each sorted(events) as event (event.id)}
        <EEW content={event.content}></EEW>
      {/each}
    </div>
  </UniqueEventList>
</NostrApp>
