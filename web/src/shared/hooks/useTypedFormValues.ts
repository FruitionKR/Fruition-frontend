import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

type FormValues = Pick<FormData, "get">;
type FieldSetters = Record<string, Dispatch<SetStateAction<string>>>;

/** 폼에 들어 있는 값을 입력 이름별 상태로 옮긴다. 비어 있는 입력은 상태를 그대로 둔다. */
export function adoptTypedValues(values: FormValues, setters: FieldSetters) {
  for (const [name, setValue] of Object.entries(setters)) {
    const value = values.get(name);
    if (typeof value === "string" && value) setValue(value);
  }
}

/**
 * 서버가 그린 폼에 스크립트가 붙기 전에 입력·자동 완성한 값은 화면에만 있다. 상태로 옮기지 않으면 다음 렌더에서 지워지거나
 * 빈 값으로 제출된다. 돌려받은 ref를 form에 붙이면 hydration 직후 한 번 옮긴다.
 */
export function useTypedFormValues(setters: FieldSetters) {
  const formRef = useRef<HTMLFormElement>(null);
  const settersRef = useRef(setters);
  useEffect(() => {
    if (formRef.current) adoptTypedValues(new FormData(formRef.current), settersRef.current);
  }, []);
  return formRef;
}
