import { readZipArchive } from "@/shared/lib/markdown-import/zipArchive";
import { buildImportPlan, type ExistingNames, type ImportPlan } from "../lib/notionPlan";

/** zip 바이트를 읽어 가져오기 계획을 만든다. 안전 검사에 걸리면 ZipSafetyError를 던진다. */
export async function analyzeNotionZip(bytes: Uint8Array, existing?: ExistingNames): Promise<ImportPlan> {
  const { entries, skippedNestedZips } = await readZipArchive(bytes);
  const plan = await buildImportPlan(entries, existing);
  return {
    ...plan,
    skipped: [...plan.skipped, ...skippedNestedZips.map((path) => ({ path, reason: "두 단계 이상 중첩된 zip" }))]
  };
}
