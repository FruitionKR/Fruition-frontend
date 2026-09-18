/** 비밀번호 정책: 15자 이상이거나, 8자 이상이면서 문자와 숫자를 모두 포함해야 한다. */
export const PASSWORD_MAX_LENGTH = 72;

export function isPasswordAllowed(password: string): boolean {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (password.length >= 15) return true;
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
