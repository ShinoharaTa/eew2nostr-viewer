<script lang="ts">
import { format, parseISO } from "date-fns";
export let content: string
$: item = (() => {
  const parsed = JSON.parse(content)
  return {
    serial: parsed.serialNo,
    forecastString: (() => {
      if(!parsed.body.intensity || !parsed.body.intensity.forecastMaxInt) return "不明"
      if(parsed.body.intensity.forecastMaxInt.to === "over") return "不明"
      if(parsed.body.intensity.forecastMaxInt.to === "5-") return "5弱"
      if(parsed.body.intensity.forecastMaxInt.to === "5+") return "5強"
      if(parsed.body.intensity.forecastMaxInt.to === "6-") return "6弱"
      if(parsed.body.intensity.forecastMaxInt.to === "6+") return "6強"
      return parsed.body.intensity.forecastMaxInt.to
    })(),
    originTime: parsed.body.earthquake.originTime,
    magnitude: parsed.body.earthquake.magnitude.value,
    hypocenter:
    {
      name: parsed.body.earthquake.hypocenter.name,
      latitude:parsed.body.earthquake.hypocenter.coordinate.latitude.value,
      longitude :parsed.body.earthquake.hypocenter.coordinate.longitude.value
    },
    depth: parsed.body.earthquake.hypocenter.depth.value
  }
})();
</script>

<div class="container outline">
  <div class="">
    {format(parseISO(item.originTime), "yyyy年MM月dd日 HH時mm分")} (第{item.serial}報)
  </div>
  <div class="">
    {item.hypocenter.name} (北緯 {item.hypocenter.latitude}度、東経 {item.hypocenter.longitude}度)
  </div>
  <div class="">
    震度 {item.forecastString} M{item.magnitude} 深さ {Math.abs(item.depth)}km
  </div>
</div>

<style lang="scss">
.outline {
  max-width: 500px;
  margin: 0 auto;
  padding: 0.8em 0 1.5em;
  border-top: 1px solid #888
}</style>