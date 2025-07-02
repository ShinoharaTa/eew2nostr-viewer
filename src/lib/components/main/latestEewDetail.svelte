<script lang="ts">
import { format, parseISO } from "date-fns";
export let content: string;
const parsed = (() => {
	return JSON.parse(content);
})();
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
  <div class="forecast font-weight-eb {forecast.color}">
    震度 {forecast.string}
  </div>
  <div class="fs-1 font-weight-bd">
    M {parsed.body.earthquake.magnitude.value}
  </div>
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
</style>