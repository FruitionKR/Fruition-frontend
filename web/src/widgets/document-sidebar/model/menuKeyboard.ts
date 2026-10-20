/**
 * 세로 메뉴(role="menu")의 방향키 이동. 눌린 키로 다음에 포커스할 항목 index를 정한다.
 * ArrowDown·ArrowUp은 끝에서 반대쪽으로 넘어가고, Home·End는 처음·끝으로 간다. 메뉴 이동 키가 아니면 null.
 * current가 -1(메뉴 안에 포커스 없음)이면 ArrowDown은 첫 항목, ArrowUp은 마지막 항목으로 간다.
 */
export function nextMenuItemIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
