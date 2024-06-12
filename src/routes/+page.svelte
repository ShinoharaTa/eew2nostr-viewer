<script lang="ts">
  import { writable } from 'svelte/store';
  import { NostrApp, UniqueEventList, Nostr } from "nosvelte";
  import { createRxForwardReq } from "rx-nostr";
  import "websocket-polyfill";

  // components
  import EEW from "./eew.svelte";

  const req = createRxForwardReq();
  const relays: string[] = ["wss://relay-jp.shino3.net", "wss://r.kojira.io"];
  const isTestMode = writable(true);
  const sorted = (events: Nostr.Event[]) => {
    return [...events].sort((a, b) => b.created_at - a.created_at);
  };
  const testMode = (events: Nostr.Event[]) => {
    if($isTestMode) return events
    return events.filter((item) =>
      item.tags.some((tagArray) => tagArray.includes("eew_alert_system_by_shino3")),
    );
  };
  const first = (events: Nostr.Event[]) => {
    return events[0];
  };
</script>

<div class="top-right-checkbox form-check">
  <input class="form-check-input" type="checkbox" id="testModeCheckbox" bind:checked={$isTestMode}>
  <label class="form-check-label" for="testModeCheckbox">テストモード</label>
</div>

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
      <EEW content={first(testMode(sorted(events))).content}></EEW>
    </div>
  </UniqueEventList>
</NostrApp>
