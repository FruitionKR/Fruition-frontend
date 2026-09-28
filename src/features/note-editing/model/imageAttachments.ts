/**
 * 편집기 이미지 첨부 (백엔드 attachment:// 계약).
 * 편집 중 이미지는 attachment://<uuid> placeholder + 브라우저 object URL로 두고,
 * 저장 시 metadata + attachment_<uuid> file part로 함께 보낸다. 서버가 관리 경로로 치환해 돌려준다.
 */

export const ATTACHMENT_SCHEME = "attachment://";
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ATTACHMENT_PATTERN = new RegExp(`${ATTACHMENT_SCHEME}(${UUID})`, "g");

// 백엔드 검증기와 같은 제한 (REQ-002). 여기서 먼저 걸러 왕복을 줄인다.
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_SAVE = 20;

export type PendingImage = { id: string; file: File; objectUrl: string };
export type SavedAttachment = { attachment_id: string; content_path: string };

/** 본문에 남아 있는 placeholder id 목록(중복 제거, 등장 순). */
export function extractAttachmentIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(ATTACHMENT_PATTERN)].map((match) => match[1].toLowerCase()))];
}

/** 업로드 전 형식·크기 검사. 문제가 없으면 null, 있으면 사용자에게 보여줄 문구. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "PNG, JPEG, WebP, GIF 이미지만 넣을 수 있습니다.";
  if (file.size === 0) return "빈 이미지 파일입니다.";
  if (file.size > MAX_IMAGE_BYTES) return "이미지는 10MB 이하만 넣을 수 있습니다.";
  return null;
}

/** 서버가 돌려준 attachment → 관리 경로 매핑을 본문에 적용한다. 매핑에 없는 placeholder는 그대로 둔다. */
export function substituteAttachmentPaths(markdown: string, saved: ReadonlyMap<string, string>): string {
  if (saved.size === 0) return markdown;
  return markdown.replace(ATTACHMENT_PATTERN, (whole, id: string) => saved.get(id.toLowerCase()) ?? whole);
}

/** 저장 전 이미지 보관소. uuid는 탭 안에서만 의미가 있어 모듈 싱글턴으로 둔다. */
class PendingImageStore {
  private readonly images = new Map<string, PendingImage>();

  /** 파일을 등록하고 본문에 넣을 placeholder를 돌려준다. */
  register(file: File): string {
    const id = crypto.randomUUID();
    this.images.set(id, { id, file, objectUrl: URL.createObjectURL(file) });
    return `${ATTACHMENT_SCHEME}${id}`;
  }

  /** placeholder 문자열이면 미리보기용 object URL, 아니면 undefined. */
  resolve(src: string): string | undefined {
    if (!src.startsWith(ATTACHMENT_SCHEME)) return undefined;
    return this.images.get(src.slice(ATTACHMENT_SCHEME.length).toLowerCase())?.objectUrl;
  }

  /** 본문에 남아 있는 placeholder 중 이 탭이 들고 있는 파일만 모은다. */
  collect(markdown: string): PendingImage[] {
    return extractAttachmentIds(markdown)
      .map((id) => this.images.get(id))
      .filter((image): image is PendingImage => Boolean(image));
  }

  /** 서버에 저장이 끝난 이미지를 내려놓는다. */
  release(ids: Iterable<string>): void {
    for (const id of ids) {
      const image = this.images.get(id);
      if (!image) continue;
      URL.revokeObjectURL(image.objectUrl);
      this.images.delete(id);
    }
  }
}

export const pendingImages = new PendingImageStore();
