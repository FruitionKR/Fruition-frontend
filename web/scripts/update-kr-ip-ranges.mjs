#!/usr/bin/env node
// DB-IP "IP to Country Lite"(CC BY 4.0)에서 한국(KR) IP 대역만 뽑아 src/shared/i18n/krIpRangesData.ts를 다시 만든다.
// 기본 언어 판정에는 "한국인가"만 필요하므로 전체 DB 대신 KR 대역만 담아 미들웨어 번들에 넣는다(요청 때 외부 호출·파일 읽기 없음).
//
// 사용법(web/에서):
//   node scripts/update-kr-ip-ranges.mjs                 # 이번 달 CSV를 받아 갱신(없으면 지난달)
//   node scripts/update-kr-ip-ranges.mjs --input <파일>  # 받아 둔 .csv 또는 .csv.gz로 갱신
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const OUTPUT = new URL("../src/shared/i18n/krIpRangesData.ts", import.meta.url);
const COUNTRY = "KR";

function monthLabel(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function download() {
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  for (const month of [monthLabel(now), monthLabel(lastMonth)]) {
    const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`;
    const response = await fetch(url);
    if (response.ok) return { month, csv: gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8") };
    console.warn(`${url}: ${response.status}`);
  }
  throw new Error("DB-IP Country Lite CSV를 받지 못했습니다.");
}

async function readInput(path) {
  const buffer = await readFile(path);
  const csv = path.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
  const month = path.match(/(\d{4}-\d{2})/)?.[1] ?? "unknown";
  return { month, csv };
}

function ipv4ToNumber(ip) {
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

/** IPv6를 128비트 정수로. 미들웨어는 앞 64비트(16자리 hex)만 비교한다. */
function ipv6ToBigInt(ip) {
  const [head, tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const parts = ip.includes("::")
    ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts]
    : headParts;
  return parts.reduce((value, part) => (value << 16n) + BigInt(parseInt(part, 16)), 0n);
}

/** 붙어 있거나 겹치는 대역을 합친다. */
function merge(ranges) {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sorted.reduce((merged, [start, end]) => {
    const last = merged.at(-1);
    if (last && start <= last[1] + (typeof start === "bigint" ? 1n : 1)) {
      return [...merged.slice(0, -1), [last[0], end > last[1] ? end : last[1]]];
    }
    return [...merged, [start, end]];
  }, []);
}

function hex64(value) {
  return value.toString(16).padStart(16, "0");
}

const inputIndex = process.argv.indexOf("--input");
const { month, csv } = inputIndex > 0 ? await readInput(process.argv[inputIndex + 1]) : await download();

const v4 = [];
const v6 = [];
for (const line of csv.split("\n")) {
  const [start, end, country] = line.trim().split(",");
  if (country !== COUNTRY) continue;
  if (start.includes(":")) v6.push([ipv6ToBigInt(start), ipv6ToBigInt(end)]);
  else v4.push([ipv4ToNumber(start), ipv4ToNumber(end)]);
}
if (v4.length === 0) throw new Error("KR 대역이 없습니다. 입력 형식을 확인하세요.");

// IPv6는 앞 64비트로 줄인다. 대역 끝을 64비트 단위로 내림하면 /64보다 작은 대역도 그 /64 전체를 덮게 된다(언어 판정에는 충분).
const v6Prefixes = merge(v6.map(([start, end]) => [start >> 64n, end >> 64n]));
const v4Merged = merge(v4);

const body = `// 이 파일은 scripts/update-kr-ip-ranges.mjs가 만든다. 직접 고치지 않는다.
// 출처: DB-IP IP to Country Lite ${month} (https://db-ip.com), CC BY 4.0. 한국(KR) 대역만 담았다.
// IP Geolocation by DB-IP (https://db-ip.com)

export const KR_IP_DATA_MONTH = "${month}";

/** IPv4 [시작, 끝] 정수 쌍을 이어 붙인 배열(오름차순, 겹침 없음) */
export const KR_IPV4_RANGES: readonly number[] = [
${v4Merged.map(([start, end]) => `${start},${end}`).join(",\n")}
];

/** IPv6 앞 64비트 [시작, 끝]을 16자리 hex로 이어 붙인 배열(오름차순, 겹침 없음) */
export const KR_IPV6_PREFIX_RANGES: readonly string[] = [
${v6Prefixes.map(([start, end]) => `"${hex64(start)}","${hex64(end)}"`).join(",\n")}
];
`;

await writeFile(OUTPUT, body);
console.log(`KR IPv4 ${v4Merged.length}개, IPv6 ${v6Prefixes.length}개 대역 (${month}) → ${OUTPUT.pathname}`);
