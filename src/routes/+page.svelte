<script lang="ts">
import { format, getUnixTime, subDays } from "date-fns";
import type { Event } from "nostr-tools/core";
import EEWItem from "$lib/components/main/eewItem.svelte";
import EEWDetail from "$lib/components/main/eewDetail.svelte";
import EEWLatest from "$lib/components/main/latestEewDetail.svelte";
import { SimplePool } from "nostr-tools/pool";
import { onMount } from "svelte";

const pool = new SimplePool();
const relays = [
	"wss://relay-jp.shino3.net",
	"wss://r.kojira.io",
	"wss://yabu.me",
];

const now = getUnixTime(new Date());
const yesterday = getUnixTime(subDays(new Date(), 7));
let eews: Map<string, Event[]> = new Map();
let selectedId: string | null = null;
$: eewEntries = Array.from(eews.entries()) as [string, Event[]][];
$: selectedEvents =
	selectedId && eews.has(selectedId) ? (eews.get(selectedId) ?? []) : [];
$: latestEvent = selectedEvents.length > 0 ? selectedEvents[selectedEvents.length - 1] : null;

$: latestEews = eewEntries
	.map(([eventId, events]) => {
		const latest = [...events]
			.sort((a, b) => a.created_at - b.created_at)
			.at(-1);
		if (!latest) return null;
		const parsed = JSON.parse(latest.content);
		const forecast = !parsed.body.intensity
			? "不明"
			: parsed.body.intensity.forecastMaxInt.to === "over"
				? "不明"
				: parsed.body.intensity.forecastMaxInt.to;
		return {
			id: eventId,
			created: latest.created_at,
			forecast,
			magnitude: parsed.body.earthquake.magnitude.value,
			hypocenter: parsed.body.earthquake.hypocenter.name,
			depth: parsed.body.earthquake.hypocenter.depth.value,
			originTime: new Date(parsed.body.earthquake.originTime),
		};
	})
	.filter((item) => !!item)
	.sort((a, b) => b.created - a.created);

// 自動選択ロジック：リストがあり、何も選択されていない場合は最新のものを選択
$: {
	if (latestEews.length > 0 && !selectedId) {
		selectedId = latestEews[0].id;
	}
}

const filter = {
	kinds: [7078],
	"#d": ["eew_alert_system_by_shino3"],
	since: yesterday,
};
onMount(() => {
	pool.subscribe(relays, filter, {
		onevent(ev) {
			const { eventId } = JSON.parse(ev.content);
			const arr = eews.get(eventId) ?? [];
			eews.set(eventId, [...arr, ev]);
			eews = new Map(eews);
		},
	});
});
</script>

<!-- <div class="top-right-checkbox form-check">
  <input class="form-check-input" type="checkbox" id="testModeCheckbox" bind:checked={$isTestMode}>
  <label class="form-check-label" for="testModeCheckbox">テストモード</label>
</div> -->

<!-- <NostrApp {relays}>
  <UniqueEventList
  >
    <div slot="loading">
      <p>Loading...</p>
    </div>

    <div slot="error" let:error>
      <p>{error}</p>
    </div>

  </UniqueEventList>
</NostrApp> -->
<div class="admin-console">
  <div class="sidebar">
    <div class="sidebar-header">
      <h2>EEW 一覧</h2>
      <div class="status-indicator">
        <span class="status-dot"></span>
        受信中
      </div>
    </div>
    <div class="eew-list">
      {#if eewEntries.length > 0}
        {#each latestEews as item}
          <div 
            class="eew-item-wrapper" 
            class:selected={selectedId === item.id}
            on:click={() => (selectedId = item.id)}
          >
            <EEWItem {item} selected={selectedId === item.id}></EEWItem>
          </div>
        {/each}
      {:else}
        <div class="no-data">
          <p>EEWイベントを受信していません</p>
        </div>
      {/if}
    </div>
  </div>

  <div class="main-content">
    <div class="content-header">
      <h2>詳細情報</h2>
      {#if selectedId}
        <div class="breadcrumb">
          EEW ID: {selectedId}
        </div>
      {/if}
    </div>
    
    <div class="detail-section">
      {#if selectedId && selectedEvents.length > 0 && latestEvent}
        <div class="latest-info">
          <h3>最新情報</h3>
          <div class="latest-card">
            <EEWLatest content={latestEvent.content}></EEWLatest>
          </div>
        </div>
        
        <div class="timeline-section">
          <h3>更新履歴（時系列）</h3>
          <div class="timeline">
            {#each selectedEvents.slice().reverse() as ev, index}
              <div class="timeline-item" class:latest={index === 0}>
                <div class="timeline-marker">
                  <div class="timeline-dot"></div>
                  {#if index < selectedEvents.length - 1}
                    <div class="timeline-line"></div>
                  {/if}
                </div>
                <div class="timeline-content">
                  <div class="update-number">第{selectedEvents.length - index}報</div>
                  <EEWDetail content={ev.content}></EEWDetail>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if latestEews.length === 0}
        <div class="no-selection">
          <div class="placeholder">
            <h3>EEWイベントを受信中...</h3>
            <p>EEWが受信されると自動的に表示されます</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
.admin-console {
  display: flex;
  height: 100vh;
  background-color: #1a1a1a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.sidebar {
  width: 380px;
  min-width: 380px;
  background-color: #2d2d2d;
  border-right: 1px solid #404040;
  display: flex;
  flex-direction: column;
  
  .sidebar-header {
    padding: 1.5rem 1rem;
    border-bottom: 1px solid #404040;
    background-color: #333;
    
    h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
    }
    
    .status-indicator {
      display: flex;
      align-items: center;
      font-size: 0.875rem;
      color: #a0a0a0;
      
      .status-dot {
        width: 8px;
        height: 8px;
        background-color: #4ade80;
        border-radius: 50%;
        margin-right: 0.5rem;
        animation: pulse 2s infinite;
      }
    }
  }
  
  .eew-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem;
    
    .eew-item-wrapper {
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s ease;
      
      &:hover {
        background-color: #3a3a3a;
      }
      
      &.selected {
        background-color: #4f46e5;
        box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
      }
    }
    
    .no-data {
      padding: 1.5rem;
      text-align: center;
      color: #a0a0a0;
    }
  }
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  
  .content-header {
    padding: 1.5rem 2rem;
    border-bottom: 1px solid #404040;
    background-color: #242424;
    
    h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
    }
    
    .breadcrumb {
      font-size: 0.875rem;
      color: #a0a0a0;
      font-family: monospace;
    }
  }
  
  .detail-section {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
    
    .latest-info {
      margin-bottom: 2rem;
      
      h3 {
        margin: 0 0 1rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #ffffff;
        border-bottom: 2px solid #4f46e5;
        padding-bottom: 0.5rem;
      }
      
      .latest-card {
        background-color: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 8px;
        padding: 1.5rem;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }
    }
    
    .timeline-section {
      h3 {
        margin: 0 0 1.5rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #ffffff;
        border-bottom: 2px solid #10b981;
        padding-bottom: 0.5rem;
      }
      
      .timeline {
        position: relative;
        
        .timeline-item {
          display: flex;
          margin-bottom: 1.5rem;
          
          &.latest .timeline-dot {
            background-color: #f59e0b;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
          }
          
          .timeline-marker {
            position: relative;
            margin-right: 1rem;
            
            .timeline-dot {
              width: 12px;
              height: 12px;
              background-color: #6b7280;
              border: 2px solid #374151;
              border-radius: 50%;
              margin-top: 0.5rem;
            }
            
            .timeline-line {
              position: absolute;
              left: 50%;
              top: 20px;
              transform: translateX(-50%);
              width: 2px;
              height: calc(100% + 1.5rem);
              background-color: #374151;
            }
          }
          
          .timeline-content {
            flex: 1;
            background-color: #2d2d2d;
            border: 1px solid #404040;
            border-radius: 8px;
            padding: 1rem;
            
            .update-number {
              font-size: 0.875rem;
              color: #10b981;
              font-weight: 600;
              margin-bottom: 0.5rem;
            }
          }
        }
      }
    }
    
    .no-selection {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      
      .placeholder {
        text-align: center;
        color: #a0a0a0;
        
        h3 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          font-weight: 500;
        }
        
        p {
          margin: 0;
          font-size: 0.875rem;
        }
      }
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* スクロールバーのカスタマイズ */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #1a1a1a;
}

::-webkit-scrollbar-thumb {
  background: #404040;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #525252;
}
</style>