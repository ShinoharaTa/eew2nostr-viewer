// 気象庁の警報・注意報コード。
// 気象庁は area.json のような定義 JSON を警報コードについては配信していないため、
// 「気象警報・注意報の種類」の一覧をここに持つ。
// 出典: https://www.jma.go.jp/jma/kishou/know/bosai/warning_kind.html

export type WarningLevel = "special" | "warning" | "advisory" | "other";

interface WarningDef {
  name: string;
  level: WarningLevel;
}

export const WARNING_CODES: Record<string, WarningDef> = {
  // 特別警報
  "32": { name: "暴風雪特別警報", level: "special" },
  "33": { name: "大雨特別警報", level: "special" },
  "35": { name: "暴風特別警報", level: "special" },
  "36": { name: "大雪特別警報", level: "special" },
  "37": { name: "波浪特別警報", level: "special" },
  "38": { name: "高潮特別警報", level: "special" },

  // 警報
  "02": { name: "暴風雪警報", level: "warning" },
  "03": { name: "大雨警報", level: "warning" },
  "04": { name: "洪水警報", level: "warning" },
  "05": { name: "暴風警報", level: "warning" },
  "06": { name: "大雪警報", level: "warning" },
  "07": { name: "波浪警報", level: "warning" },
  "08": { name: "高潮警報", level: "warning" },

  // 注意報
  "10": { name: "大雨注意報", level: "advisory" },
  "12": { name: "大雪注意報", level: "advisory" },
  "13": { name: "風雪注意報", level: "advisory" },
  "14": { name: "雷注意報", level: "advisory" },
  "15": { name: "強風注意報", level: "advisory" },
  "16": { name: "波浪注意報", level: "advisory" },
  "17": { name: "融雪注意報", level: "advisory" },
  "18": { name: "洪水注意報", level: "advisory" },
  "19": { name: "高潮注意報", level: "advisory" },
  "20": { name: "濃霧注意報", level: "advisory" },
  "21": { name: "乾燥注意報", level: "advisory" },
  "22": { name: "なだれ注意報", level: "advisory" },
  "23": { name: "低温注意報", level: "advisory" },
  "24": { name: "霜注意報", level: "advisory" },
  "25": { name: "着氷注意報", level: "advisory" },
  "26": { name: "着雪注意報", level: "advisory" },

  "27": { name: "その他の警報等", level: "other" },
};

export function warningName(code: string): string {
  return WARNING_CODES[code]?.name ?? `不明な警報 (${code})`;
}

export function warningLevel(code: string): WarningLevel {
  return WARNING_CODES[code]?.level ?? "other";
}

// 段階の強さ。塗り分けと並び順に使う。
export const LEVEL_RANK: Record<WarningLevel, number> = {
  special: 3,
  warning: 2,
  advisory: 1,
  other: 0,
};

export const LEVEL_LABEL: Record<WarningLevel, string> = {
  special: "特別警報",
  warning: "警報",
  advisory: "注意報",
  other: "その他",
};

// 気象庁の配色指針に沿う。装飾ではなく段階の符号化。
// 出典: https://www.jma.go.jp/jma/kishou/info/colorguide/HPColorGuide_202007.pdf
export const LEVEL_COLOR: Record<WarningLevel, string> = {
  special: "#a50021",
  warning: "#ff2800",
  advisory: "#f2e700",
  other: "#8d979c",
};
