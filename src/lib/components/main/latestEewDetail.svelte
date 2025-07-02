<script lang="ts">
import { format, parseISO } from "date-fns";
export let content: string;

$: parsed = JSON.parse(content);

$: forecast = (() => {
	return {
		string: (() => {
			if (!parsed.body.intensity) return "不明";
			if (parsed.body.intensity.forecastMaxInt.to === "over") return "不明";
			if (parsed.body.intensity.forecastMaxInt.to === "5-") return "5弱";
			if (parsed.body.intensity.forecastMaxInt.to === "5+") return "5強";
			if (parsed.body.intensity.forecastMaxInt.to === "6-") return "6弱";
			if (parsed.body.intensity.forecastMaxInt.to === "6+") return "6強";
			return parsed.body.intensity.forecastMaxInt.to;
		})(),
		color: (() => {
			if (!parsed.body.intensity || !parsed.body.intensity.forecastMaxInt) return "";
			if (parsed.body.intensity.forecastMaxInt.to === "4") return "text-warning";
			if (parsed.body.intensity.forecastMaxInt.to === "5-") return "text-warning";
			if (parsed.body.intensity.forecastMaxInt.to === "5+") return "text-danger";
			if (parsed.body.intensity.forecastMaxInt.to === "6-") return "text-danger";
			if (parsed.body.intensity.forecastMaxInt.to === "6+") return "text-danger";
			if (parsed.body.intensity.forecastMaxInt.to === "7") return "text-danger";
			return "";
		})(),
	};
})();
</script>

<div class="container outline text-center">
  <div class="fs-2">
    {format(parseISO(parsed.body.earthquake.originTime), "yyyy年MM月dd日 HH時mm分")}
  </div>
  
  {#if forecast.string === "不明"}
    <!-- 震度不明の場合：マグニチュード表記を大きく -->
    <div class="magnitude-primary">
      <span class="magnitude-prefix">M</span><span class="magnitude-value">{parsed.body.earthquake.magnitude.value}</span>
    </div>
    <div class="intensity-secondary {forecast.color}">
      震度不明
    </div>
  {:else}
    <!-- 震度ありの場合：震度数字を大きく -->
    <div class="intensity-primary {forecast.color}">
      <span class="intensity-label">震度</span>
      <span class="intensity-value">{forecast.string}</span>
    </div>
    <div class="magnitude-secondary">
      M {parsed.body.earthquake.magnitude.value}
    </div>
  {/if}
  
  <div class="fs-1 font-weight-eb">
    {parsed.body.earthquake.hypocenter.name}
  </div>
  <div class="fs-4 mt-3">
    北緯 {parsed.body.earthquake.hypocenter.coordinate.latitude.value}度<br />
    東経 {parsed.body.earthquake.hypocenter.coordinate.longitude.value}度<br />
    深さ {Math.abs(parsed.body.earthquake.hypocenter.depth.value,)}km
  </div>
</div>

<style lang="scss">
.outline {
  max-width: 500px;
  margin: 0 auto;
  padding: 0.8em 0 1.5em;
  // border-top: 1px solid #888
}

.forecast {
  font-size: 7rem;
}

/* 震度不明時：マグニチュード優先表示 */
.magnitude-primary {
  font-family: "LINE_SEED_Bd", monospace;
  font-size: 7rem;
  margin: 1rem 0;
  
  .magnitude-prefix {
    font-size: 4rem;
    opacity: 0.8;
    vertical-align: super;
  }
  
  .magnitude-value {
    font-size: 7rem;
    font-family: "LINE_SEED_Eb";
  }
}

.intensity-secondary {
  font-size: 2rem;
  font-family: "LINE_SEED_Bd";
  color: #9ca3af;
  margin-bottom: 1rem;
}

/* 震度あり時：震度数字優先表示 */
.intensity-primary {
  font-family: "LINE_SEED_Bd";
  margin: 1rem 0;
  
  .intensity-label {
    font-size: 2.5rem;
    opacity: 0.7;
    margin-right: 0.5rem;
  }
  
  .intensity-value {
    font-size: 7rem;
    font-family: "LINE_SEED_Eb";
  }
}

.magnitude-secondary {
  font-size: 2.5rem;
  font-family: "LINE_SEED_Bd";
  color: #6b7280;
  margin-bottom: 1rem;
}
</style>