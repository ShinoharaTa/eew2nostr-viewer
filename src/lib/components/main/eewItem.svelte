<script lang="ts">
import { format } from "date-fns";
export let item: {
	forecast: string;
	hypocenter: string;
	depth: string;
	magnitude: string;
	originTime: Date;
};
export let selected: boolean
</script>

<section class="eew-item {selected ? 'selected' : ''}">
  <div class="intensity-section">
    {#if item.forecast === "不明"}
      <div class="magnitude-primary" class:magnitude-warning={parseFloat(item.magnitude) >= 5.0 && parseFloat(item.magnitude) < 7.0} class:magnitude-danger={parseFloat(item.magnitude) >= 7.0}>
        <span class="magnitude-prefix">M</span>{item.magnitude}
      </div>
      <div class="forecast-secondary">
        <span class="undefined-small">震度不明</span>
      </div>
    {:else}
      <div class="forecast">
        {#if item.forecast === "4"}
          <span class="intensity-4">{item.forecast}</span>
        {:else if item.forecast === "5-"}
          <span class="intensity-5-">{item.forecast}</span><span class="intensity-note">弱</span>
        {:else if item.forecast === "5+"}
          <span class="intensity-5+">{item.forecast}</span><span class="intensity-note">強</span>
        {:else if item.forecast === "6-"}
          <span class="intensity-6-">{item.forecast}</span><span class="intensity-note">弱</span>
        {:else if item.forecast === "6+"}
          <span class="intensity-6+">{item.forecast}</span><span class="intensity-note">強</span>
        {:else if item.forecast === "7"}
          <span class="intensity-7">{item.forecast}</span>
        {:else}
          <span>{item.forecast}</span>
        {/if}
      </div>
      <div class="magnitude">
        M{item.magnitude}
      </div>
    {/if}
  </div>
  <div class="details-section">
    <div class="hypocenter">{item.hypocenter}</div>
    <div class="metadata">
      <span class="time">{format(new Date(item.originTime), "yyyy-MM-dd HH:mm")}</span>
      {#if item.depth}
        <span class="depth">深さ {item.depth}km</span>
      {/if}
    </div>
  </div>
</section>

<style lang="scss">
.eew-item {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  margin: 0.125rem 0;
  border-radius: 4px;
  border: 1px solid #404040;
  background-color: #2a2a2a;
  transition: all 0.2s ease;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    padding: 0.75rem;
    margin: 0.25rem 0;
    min-height: 60px;
  }
  
  &:hover {
    border-color: #525252;
    background-color: #323232;
  }
  
  &.selected {
    border-color: #4f46e5;
    background-color: #312e81;
    box-shadow: 0 0 0 1px rgba(79, 70, 229, 0.3);
  }
}

.intensity-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-right: 0.75rem;
  min-width: 50px;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    margin-right: 1rem;
    min-width: 60px;
  }
}

.forecast {
  font-family: "LINE_SEED_Eb", monospace;
  font-size: 1.25rem;
  line-height: 1.1;
  text-align: center;
  font-weight: bold;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    font-size: 1.5rem;
    line-height: 1.2;
  }
  
  .intensity-4 {
    color: #fbbf24;
  }
  
  .intensity-5- {
    color: #f97316;
  }
  
  .intensity-5\+ {
    color: #f97316;
  }
  
  .intensity-6- {
    color: #dc2626;
  }
  
  .intensity-6\+ {
    color: #dc2626;
  }
  
  .intensity-7 {
    color: #991b1b;
    background-color: #fef2f2;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
  }
  
  .intensity-note {
    font-size: 0.625rem;
    margin-left: 0.125rem;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      font-size: 0.75rem;
    }
  }
}

.magnitude-primary {
  font-family: "LINE_SEED_Eb", monospace;
  font-size: 1.25rem;
  font-weight: bold;
  text-align: center;
  line-height: 1.1;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
  
  .magnitude-prefix {
    font-size: 0.875rem;
    opacity: 0.8;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      font-size: 1rem;
    }
  }
  
  /* マグニチュード基準の色分け */
  &.magnitude-warning {
    color: #fbbf24;
  }
  
  &.magnitude-danger {
    color: #dc2626;
  }
}

.forecast-secondary {
  margin-top: 0.125rem;
  text-align: center;
}

.undefined-small {
  font-size: 0.5rem;
  color: #9ca3af;
  background-color: #374151;
  padding: 0.0625rem 0.25rem;
  border-radius: 2px;
  font-family: monospace;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    font-size: 0.625rem;
    padding: 0.125rem 0.375rem;
  }
}

.magnitude {
  font-size: 0.625rem;
  color: #9ca3af;
  text-align: center;
  margin-top: 0.125rem;
  font-family: monospace;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    font-size: 0.75rem;
  }
}

.details-section {
  flex: 1;
  min-width: 0;
}

.hypocenter {
  font-size: 0.875rem;
  font-weight: 500;
  color: #f3f4f6;
  margin-bottom: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    font-size: 1rem;
    margin-bottom: 0.25rem;
    white-space: normal;
    word-wrap: break-word;
    line-height: 1.3;
  }
}

.metadata {
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  
  /* モバイル対応 */
  @media (max-width: 768px) {
    gap: 0.125rem;
  }
  
  .time, .depth {
    font-size: 0.625rem;
    color: #9ca3af;
    font-family: monospace;
    
    /* モバイル対応 */
    @media (max-width: 768px) {
      font-size: 0.75rem;
    }
  }
}

@media (prefers-color-scheme: dark) {
  .intensity-7 {
    background-color: #450a0a;
    color: #fca5a5;
  }
}
</style>