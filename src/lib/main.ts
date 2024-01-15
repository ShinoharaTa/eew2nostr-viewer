import { get } from "svelte/store";
import type { Filter } from "nostr-typedef";
import { kinds } from "nostr-tools";
import {
  now,
  batch,
  createRxBackwardReq,
  createRxNostr,
  filterByType,
  latestEach,
  uniq,
  type ConnectionState,
  createRxForwardReq,
} from "rx-nostr";
import { tap, bufferTime } from "rxjs";
// import { timeout } from "$lib/Constants";
// import { filterTags } from "$lib/EventHelper";
// import { EventItem, Metadata } from "$lib/Items";
// import { eventItemStore, metadataStore } from "../cache/Events";
// import { Content } from "$lib/Content";
// import { ToastNotification } from "$lib/ToastNotification";
// import { sleep } from "$lib/Helper";

export const rxNostr = createRxNostr();

const forward = createRxForwardReq();
const since = Math.floor(Date.now() / 1000);
const filters: Filter = {
  kinds: [kinds.Application],
  "#p": [],
  since,
};

rxNostr
  .use(forward)
  .pipe(uniq())
  .subscribe(async (packet) => {
    const { event } = packet;
    if (event.kind === 30078) {
      const tag = event.tags.find(([item]) => item === "d");
      const databaseName = tag ? tag.at(1) : null;
      console.log(databaseName);
      console.log(event.content);
      forward.emit([filters]);
    }
  });
