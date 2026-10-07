// pdf.js가 런타임에 fetch하는 CMap·표준 폰트·wasm 디코더를 public/pdfjs로 복사한다.
// 번들러가 옮겨 주지 않는 파일이라, 없으면 폰트 비임베드 한글 PDF가 깨지고 JPX 이미지가 비어 보인다.
// dev·build 전에 실행한다(Docker 빌드 단계는 COPY . . 뒤에 npm run build를 하므로 prebuild로 충분하다).
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "pdfjs-dist");
const target = path.join(root, "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(path.join(source, dir), path.join(target, dir), { recursive: true });
}
