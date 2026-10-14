/** 비밀번호 정책: 15자 이상이거나, 8자 이상이면서 문자와 숫자를 모두 포함해야 한다. */
export const PASSWORD_MAX_LENGTH = 72;

export function isPasswordAllowed(password: string): boolean {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (password.length >= 15) return true;
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

const PASSWORD_MIN_LENGTH = 8;

/** 비밀번호 생성 화면(회원가입·재설정)에 보여줄 정책 위반 안내. 허용되면 null. */
export function getPasswordPolicyError(password: string): string | null {
  if (isPasswordAllowed(password)) return null;
  if (password.length < PASSWORD_MIN_LENGTH) return "비밀번호는 8자 이상 입력해주세요.";
  if (password.length > PASSWORD_MAX_LENGTH) return "비밀번호는 72자 이하로 입력해주세요.";
  return "영어, 숫자 조합으로 입력해주세요.";
}

// 한글 완성형·호환 자모·첫가끝 자모. 한/영 전환을 놓쳐 입력된 글자를 알아본다.
const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏가-힣]/;

/** 비밀번호 칸에 한글이 섞였는지. 한글 비밀번호도 허용되므로 막지 않고 경고에만 쓴다. */
export function hasHangul(value: string): boolean {
  return HANGUL_PATTERN.test(value);
}
