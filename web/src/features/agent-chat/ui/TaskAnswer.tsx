import { taskAnswerBlocks } from "../lib/taskAnswer";
import styles from "./AgentChat.module.css";

/** 작업 탭 답변(폴더 내용 조회). 문단 줄바꿈과 `- ` 목록만 살리고 글자는 텍스트로만 그린다. */
export function TaskAnswer({ text }: { text: string }) {
  return (
    <div className={styles["task-answer"]}>
      {taskAnswerBlocks(text).map((block, index) => block.kind === "list" ? (
        <ul key={index} className={styles["task-answer-list"]}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
        </ul>
      ) : (
        <p key={index}>{block.text}</p>
      ))}
    </div>
  );
}
