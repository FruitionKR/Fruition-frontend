// 본문 저장 자동 병합 흉내: 줄 단위 3-way merge(diff3). 서버(document)와 같은 규칙으로 겹치면 요청 본(mine)이 이긴다.

/** base → side로 바뀐 구간들. 각 구간은 base[baseStart, baseEnd)가 side[sideStart, sideEnd)로 바뀐 것이다. */
function changedRegions(base, side) {
  const n = base.length;
  const m = side.length;
  // 뒤에서부터 LCS 길이 표. 문서가 작아 O(n·m)로 충분하다.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = base[i] === side[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const regions = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (open) regions.push({ ...open, baseEnd: i, sideEnd: j });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    if (!open) open = { baseStart: i, sideStart: j };
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) j += 1;
    else i += 1;
  }
  close();
  return regions;
}

/** side에서 base[lo, hi)에 해당하는 줄들. 그 구간의 side 변경(regions)을 반영한다. */
function sideSlice(base, side, regions, lo, hi) {
  if (regions.length === 0) return base.slice(lo, hi);
  const first = regions[0];
  const last = regions[regions.length - 1];
  const start = first.sideStart - (first.baseStart - lo);
  const end = last.sideEnd + (hi - last.baseEnd);
  return side.slice(start, end);
}

/**
 * base·theirs(서버 현재)·mine(요청)을 줄 단위로 합친다.
 * 겹치는 구간에서 양쪽 결과가 다르면 conflict이고 그 구간은 mine을 쓴다.
 */
export function merge3(baseText, theirsText, mineText) {
  const base = baseText.split("\n");
  const theirs = theirsText.split("\n");
  const mine = mineText.split("\n");
  const hunks = [
    ...changedRegions(base, theirs).map((region) => ({ ...region, side: "theirs" })),
    ...changedRegions(base, mine).map((region) => ({ ...region, side: "mine" }))
  ].sort((a, b) => a.baseStart - b.baseStart || a.baseEnd - b.baseEnd);

  // 맞닿거나 겹치는 구간을 한 묶음으로 본다(같은 자리 삽입도 겹침이다).
  const groups = [];
  for (const hunk of hunks) {
    const group = groups[groups.length - 1];
    if (group && hunk.baseStart <= group.hi) {
      group.hi = Math.max(group.hi, hunk.baseEnd);
      group.hunks.push(hunk);
    } else {
      groups.push({ lo: hunk.baseStart, hi: hunk.baseEnd, hunks: [hunk] });
    }
  }

  const merged = [];
  let conflict = false;
  let cursor = 0;
  for (const group of groups) {
    merged.push(...base.slice(cursor, group.lo));
    const theirsRegions = group.hunks.filter((hunk) => hunk.side === "theirs");
    const mineRegions = group.hunks.filter((hunk) => hunk.side === "mine");
    const theirsLines = sideSlice(base, theirs, theirsRegions, group.lo, group.hi);
    const mineLines = sideSlice(base, mine, mineRegions, group.lo, group.hi);
    if (theirsRegions.length === 0) merged.push(...mineLines);
    else if (mineRegions.length === 0) merged.push(...theirsLines);
    else {
      if (theirsLines.join("\n") !== mineLines.join("\n")) conflict = true;
      merged.push(...mineLines);
    }
    cursor = group.hi;
  }
  merged.push(...base.slice(cursor));
  return { markdown: merged.join("\n"), conflict };
}
