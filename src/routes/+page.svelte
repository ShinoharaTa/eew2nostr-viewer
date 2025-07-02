<script lang="ts">
import { format, getUnixTime, subDays } from "date-fns";
import type { Event } from "nostr-tools/core";
import EEWItem from "$lib/components/main/eewItem.svelte";
import EEWDetail from "$lib/components/main/eewDetail.svelte";
import EEWLatest from "$lib/components/main/latestEewDetail.svelte";
import { SimplePool } from "nostr-tools/pool";
import { onMount, onDestroy } from "svelte";
import { browser } from '$app/environment';

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
let isMobileMenuOpen = false; // モバイルメニューの開閉状態
$: eewEntries = Array.from(eews.entries()) as [string, Event[]][];

// selectedIdとeewsマップの両方に依存するリアクティブ計算
$: selectedEvents = (() => {
	if (!selectedId || !eews.has(selectedId)) {
		return [];
	}
	const events = eews.get(selectedId) ?? [];
	return events.sort((a, b) => a.created_at - b.created_at);
})();

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

// メニュー開閉関数
function toggleMobileMenu() {
	isMobileMenuOpen = !isMobileMenuOpen;
}

function closeMobileMenu() {
	isMobileMenuOpen = false;
}

// EEW選択時にモバイルメニューを閉じる
function selectEEW(id: string) {
	selectedId = id;
	if (browser && window.innerWidth <= 768) {
		closeMobileMenu();
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
	
	// イベントリスナーの追加（ブラウザ環境でのみ）
	if (browser) {
		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('resize', handleResize);
	}
});

onDestroy(() => {
	// イベントリスナーのクリーンアップ（ブラウザ環境でのみ）
	if (browser) {
		window.removeEventListener('keydown', handleKeydown);
		window.removeEventListener('resize', handleResize);
	}
});

// キーボードイベントハンドラ
function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape' && isMobileMenuOpen) {
		closeMobileMenu();
	}
}

// ウィンドウリサイズ時の処理
function handleResize() {
	if (browser && window.innerWidth > 768 && isMobileMenuOpen) {
		closeMobileMenu();
	}
}

// キーボードイベントハンドラー（EEWアイテム用）
function handleEEWItemKeydown(event: KeyboardEvent, itemId: string) {
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		selectEEW(itemId);
	}
}
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
  <!-- モバイル用オーバーレイ -->
  {#if isMobileMenuOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="mobile-overlay" on:click={closeMobileMenu}></div>
  {/if}

  <!-- サイドバー -->
  <div class="sidebar" class:mobile-open={isMobileMenuOpen}>
    <div class="sidebar-header">
      <div class="status-indicator">
        <span class="status-dot"></span>
        受信中
      </div>
      <!-- モバイル用閉じるボタン -->
      <button 
        class="mobile-close-btn" 
        on:click={closeMobileMenu}
        aria-label="メニューを閉じる"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="eew-list">
      {#if eewEntries.length > 0}
        {#each latestEews as item}
          <div 
            class="eew-item-wrapper" 
            class:selected={selectedId === item.id}
            role="button"
            tabindex="0"
            on:click={() => selectEEW(item.id)}
            on:keydown={(e) => handleEEWItemKeydown(e, item.id)}
            aria-label="EEW {item.hypocenter} 震度{item.forecast} マグニチュード{item.magnitude}"
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

  <!-- メインコンテンツ -->
  <div class="main-content">
    <div class="content-header">
      <!-- モバイル用メニューボタン -->
      <button 
        class="mobile-menu-btn" 
        on:click={toggleMobileMenu}
        aria-label="メニューを開く"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      {#if selectedId}
        <h1 class="eew-title">EEW {selectedId}</h1>
      {:else}
        <h1 class="eew-title">EEW ビューアー</h1>
      {/if}
    </div>
    
    <div class="detail-section">
      {#if selectedId && selectedEvents.length > 0 && latestEvent}
        <div class="latest-info">
          <div class="latest-card">
            <EEWLatest content={latestEvent.content}></EEWLatest>
          </div>
        </div>
        
        <div class="timeline-section">
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
  position: relative;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    flex-direction: row; /* 2カラムを維持 */
  }
}

/* モバイル用オーバーレイ */
.mobile-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 998;
  display: none;
  
  @media (max-width: 768px) {
    display: block;
  }
}

/* モバイル用メニューボタン */
.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  color: #ffffff;
  padding: 0.5rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: #404040;
  }
  
  @media (max-width: 768px) {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

/* モバイル用閉じるボタン */
.mobile-close-btn {
  display: none;
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  color: #ffffff;
  padding: 0.5rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: #404040;
  }
  
  @media (max-width: 768px) {
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

.sidebar {
  width: 380px;
  min-width: 380px;
  background-color: #2d2d2d;
  border-right: 1px solid #404040;
  display: flex;
  flex-direction: column;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    position: fixed;
    top: 0;
    left: 0;
    width: 320px;
    min-width: 320px;
    height: 100vh;
    z-index: 999;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    border-right: none;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.3);
    
    &.mobile-open {
      transform: translateX(0);
    }
  }
  
  .sidebar-header {
    padding: 1.5rem 1rem;
    border-bottom: 1px solid #404040;
    background-color: #333;
    position: relative;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      padding: 1rem 3rem 1rem 1rem; /* 右側に閉じるボタンの余白 */
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
      
      /* モバイル対応：タップしやすいサイズ */
      @media (max-width: 768px) {
        min-height: 48px;
      }
      
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
      
      /* モバイル対応 */
      @media (max-width: 768px) {
        padding: 1rem;
        font-size: 0.875rem;
      }
    }
  }
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    width: 100%;
    height: 100vh;
  }
  
  .content-header {
    padding: 1.5rem 2rem;
    border-bottom: 1px solid #404040;
    background-color: #242424;
    display: flex;
    align-items: center;
    gap: 1rem;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      padding: 1rem;
      gap: 0.75rem;
    }
    
    .eew-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
      font-family: monospace;
      flex: 1;
      
      /* モバイル対応 */
      @media (max-width: 768px) {
        font-size: 1.125rem;
      }
    }
  }
  
  .detail-section {
    flex: 1;
    overflow-y: auto;
    padding: 2rem;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      padding: 1rem;
    }
    
    .latest-info {
      margin-bottom: 2rem;
      
      /* モバイル対応 */
      @media (max-width: 768px) {
        margin-bottom: 1rem;
      }
      
      .latest-card {
        background-color: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 8px;
        padding: 1.5rem;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        
        /* モバイル対応 */
        @media (max-width: 768px) {
          padding: 1rem;
          border-radius: 6px;
        }
      }
    }
    
    .timeline-section {
      .timeline {
        position: relative;
        
        .timeline-item {
          display: flex;
          margin-bottom: 1.5rem;
          
          /* モバイル対応 */
          @media (max-width: 768px) {
            margin-bottom: 1rem;
          }
          
          &.latest .timeline-dot {
            background-color: #f59e0b;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
          }
          
          .timeline-marker {
            position: relative;
            margin-right: 1rem;
            
            /* モバイル対応 */
            @media (max-width: 768px) {
              margin-right: 0.75rem;
            }
            
            .timeline-dot {
              width: 12px;
              height: 12px;
              background-color: #6b7280;
              border: 2px solid #374151;
              border-radius: 50%;
              margin-top: 0.5rem;
              
              /* モバイル対応 */
              @media (max-width: 768px) {
                width: 10px;
                height: 10px;
                margin-top: 0.25rem;
              }
            }
            
            .timeline-line {
              position: absolute;
              left: 50%;
              top: 20px;
              transform: translateX(-50%);
              width: 2px;
              height: calc(100% + 1.5rem);
              background-color: #374151;
              
              /* モバイル対応 */
              @media (max-width: 768px) {
                top: 15px;
                height: calc(100% + 1rem);
              }
            }
          }
          
          .timeline-content {
            flex: 1;
            background-color: #2d2d2d;
            border: 1px solid #404040;
            border-radius: 8px;
            padding: 1rem;
            
            /* モバイル対応 */
            @media (max-width: 768px) {
              padding: 0.75rem;
              border-radius: 6px;
            }
            
            .update-number {
              font-size: 0.875rem;
              color: #10b981;
              font-weight: 600;
              margin-bottom: 0.5rem;
              
              /* モバイル対応 */
              @media (max-width: 768px) {
                font-size: 0.75rem;
                margin-bottom: 0.25rem;
              }
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
          
          /* モバイル対応 */
          @media (max-width: 768px) {
            font-size: 1.125rem;
          }
        }
        
        p {
          margin: 0;
          font-size: 0.875rem;
          
          /* モバイル対応 */
          @media (max-width: 768px) {
            font-size: 0.75rem;
          }
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
  
  /* モバイル対応：スクロールバーを細く */
  @media (max-width: 768px) {
    width: 4px;
  }
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