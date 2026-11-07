import { KR_IPV4_RANGES, KR_IPV6_PREFIX_RANGES } from "./krIpRangesData";

/**
 * IP 주소 해석과 한국 대역 판정. 요청 때 외부 API를 부르지 않고 번들에 넣은 KR 대역(DB-IP Lite)만 본다.
 * 미들웨어(Edge 런타임)에서도 돌도록 BigInt·Node API 없이 문자열·정수만 쓴다.
 */

type ParsedIp = { version: 4; value: number } | { version: 6; groups: number[] };

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** IPv6를 16비트 8묶음으로 펼친다. 끝이 IPv4 표기(::ffff:1.2.3.4)인 경우도 받는다. */
function parseIpv6(ip: string): number[] | null {
  const zoneless = ip.split("%")[0];
  if ((zoneless.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = zoneless.includes("::") ? zoneless.split("::") : [zoneless, null];
  const toGroups = (text: string): number[] | null => {
    if (!text) return [];
    const groups: number[] = [];
    for (const piece of text.split(":")) {
      if (piece.includes(".")) {
        const v4 = parseIpv4(piece);
        if (v4 === null) return null;
        groups.push(Math.floor(v4 / 65536), v4 % 65536);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const headGroups = toGroups(head);
  const tailGroups = tail === null ? [] : toGroups(tail);
  if (!headGroups || !tailGroups) return null;
  const missing = 8 - headGroups.length - tailGroups.length;
  if (tail === null ? missing !== 0 : missing < 1) return null;
  return [...headGroups, ...Array<number>(Math.max(missing, 0)).fill(0), ...tailGroups];
}

export function parseIp(raw: string): ParsedIp | null {
  const ip = raw.trim().replace(/^\[(.+)\](?::\d+)?$/, "$1");
  if (ip.includes(":") && !/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    const groups = parseIpv6(ip);
    if (!groups) return null;
    // IPv4-mapped(::ffff:a.b.c.d)는 IPv4로 다룬다.
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      return { version: 4, value: groups[6] * 65536 + groups[7] };
    }
    return { version: 6, groups };
  }
  const value = parseIpv4(ip.replace(/:\d+$/, ""));
  return value === null ? null : { version: 4, value };
}

function inIpv4Cidr(value: number, base: string, bits: number): boolean {
  const start = parseIpv4(base) ?? 0;
  const size = 2 ** (32 - bits);
  return value >= start && value < start + size;
}

const PRIVATE_IPV4: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16]
];

/** 사설·루프백·링크 로컬처럼 국가를 알 수 없는 주소인지. */
export function isPrivateIp(ip: ParsedIp): boolean {
  if (ip.version === 4) return PRIVATE_IPV4.some(([base, bits]) => inIpv4Cidr(ip.value, base, bits));
  const [first] = ip.groups;
  const isUnspecifiedOrLoopback = ip.groups.slice(0, 7).every((group) => group === 0) && ip.groups[7] <= 1;
  // fc00::/7(고유 로컬), fe80::/10(링크 로컬)
  return isUnspecifiedOrLoopback || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/** 정렬된 [시작, 끝] 쌍 배열에서 값이 든 쌍이 있는지 이진 탐색한다. */
function inRanges<T extends number | string>(ranges: readonly T[], value: T): boolean {
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = ranges[mid * 2];
    const end = ranges[mid * 2 + 1];
    if (value < start) high = mid - 1;
    else if (value > end) low = mid + 1;
    else return true;
  }
  return false;
}

/** 공인 IP가 한국 대역인지. 사설·해석 불가 주소는 판정할 수 없어 null이다. */
export function isKoreanIp(raw: string): boolean | null {
  const ip = parseIp(raw);
  if (!ip || isPrivateIp(ip)) return null;
  if (ip.version === 4) return inRanges(KR_IPV4_RANGES, ip.value);
  const prefix = ip.groups.slice(0, 4).map((group) => group.toString(16).padStart(4, "0")).join("");
  return inRanges(KR_IPV6_PREFIX_RANGES, prefix);
}
