// AI ingest의 원본 block 스냅샷 흉내. Fruition-ai `MarkdownBlockExtractor._split_blocks` 규칙과
// 영구 block ID(변경 없는 block은 ID 유지, 새 block은 최대번호+1)를 따른다.
import { createHash } from "node:crypto";

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const normalizeSpace = (text) => text.replace(/\s+/g, " ").trim();

/** 빈 줄·코드 펜스·# 헤딩 단위로 자른다. 줄 번호는 '\n' 기준 1부터, 양끝 포함. */
function splitBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let buffer = [];
  let bufferStart = 1;
  let inCode = false;

  const flush = (endLine) => {
    const raw = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    buffer = [];
    if (!raw.trim()) return;
    let type = raw.trim().startsWith("```") ? "code" : "paragraph";
    if (raw.trimStart().startsWith("#") && !raw.trim().includes("\n")) type = "heading";
    else if (/^(- |\* |1\. )/.test(raw.trimStart())) type = "list";
    blocks.push({ type, raw, start: bufferStart, end: endLine });
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      if (!inCode) {
        flush(lineNumber - 1);
        bufferStart = lineNumber;
        buffer = [line];
        inCode = true;
      } else {
        buffer.push(line);
        flush(lineNumber);
        inCode = false;
      }
      return;
    }
    if (inCode) {
      buffer.push(line);
      return;
    }
    if (!stripped) {
      flush(lineNumber - 1);
      return;
    }
    if (stripped.startsWith("#")) {
      flush(lineNumber - 1);
      bufferStart = lineNumber;
      buffer = [line];
      flush(lineNumber);
      return;
    }
    if (buffer.length === 0) bufferStart = lineNumber;
    buffer.push(line);
  });
  flush(lines.length);
  return blocks;
}

const blockNumber = (blockId) => Number(/^B(\d+)$/.exec(blockId)?.[1] ?? 0);
const formatBlockId = (number) => `B${String(number).padStart(4, "0")}`;

/**
 * ingest 성공 시점의 block 스냅샷을 만든다. 이전 스냅샷에 같은 텍스트 block이 있으면 그 ID를 유지하고,
 * 새 block은 위치와 무관하게 최대번호+1을 받는다. blockIds를 주면 그 ID를 순서대로 쓴다(시드용).
 */
export function ingestSourceBlocks(markdown, previousBlocks = [], blockIds = null) {
  const unused = [...previousBlocks];
  let maxNumber = Math.max(0, ...previousBlocks.map((block) => blockNumber(block.block_id)));
  const blocks = splitBlocks(markdown).map((block, index) => {
    const text = normalizeSpace(block.raw);
    let blockId = blockIds?.[index];
    if (!blockId) {
      const reusedIndex = unused.findIndex((previous) => previous.text === text);
      if (reusedIndex >= 0) {
        blockId = unused[reusedIndex].block_id;
        unused.splice(reusedIndex, 1);
      } else {
        maxNumber += 1;
        blockId = formatBlockId(maxNumber);
      }
    }
    return { block_id: blockId, position: index + 1, line_start: block.start, line_end: block.end, block_type: block.type, text };
  });
  return { content_hash: sha256(markdown), blocks };
}
