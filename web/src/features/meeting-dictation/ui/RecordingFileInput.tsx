import { forwardRef } from "react";
import { MEETING_RECORDING_ACCEPT } from "@/entities/meeting";

/**
 * 녹음 파일 선택 창을 여는 숨은 input. 파형 버튼 메뉴·회의 화면의 버튼이 ref.click()으로 연다(사용자 클릭 안에서 불러야 열린다).
 * 같은 파일을 다시 골라도 change가 오도록 고른 뒤 값을 비운다.
 */
export const RecordingFileInput = forwardRef<HTMLInputElement, { onSelect: (file: File) => void }>(
  function RecordingFileInput({ onSelect }, ref) {
    return (
      <input
        ref={ref}
        type="file"
        accept={MEETING_RECORDING_ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onSelect(file);
        }}
      />
    );
  }
);
