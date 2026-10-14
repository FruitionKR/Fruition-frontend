import type { LocalFolderPort, SyncState, SyncStatePort } from "@/features/desktop-sync/model/syncEngine";

/** Fruition-desktop의 preload가 노출하는 API. 요청 이름과 인자는 main 프로세스가 검사한다. */
export type DesktopApi = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** 메뉴 막대의 "지금 동기화". 해제 함수를 돌려준다. */
  onSyncNow(listener: () => void): () => void;
};

export type DesktopConnection = { workspaceId: string; folderPath: string; mode: "auto" | "manual" };

declare global {
  interface Window {
    fruitionDesktop?: DesktopApi;
  }
}

/** 맥 데스크톱 앱 안에서만 있다. 웹 브라우저에서는 null이다. */
export function getDesktopApi(): DesktopApi | null {
  return typeof window !== "undefined" && window.fruitionDesktop ? window.fruitionDesktop : null;
}

export async function listConnections(desktop: DesktopApi): Promise<DesktopConnection[]> {
  return (await desktop.invoke("listConnections")) as DesktopConnection[];
}

/** 연결 폴더 접근을 동기화 엔진의 포트로 만든다. File·Blob은 IPC로 넘길 수 없어 바이트로 주고받는다. */
export function createDesktopFolderPort(desktop: DesktopApi, workspaceId: string): LocalFolderPort {
  const call = <T>(channel: string, ...args: unknown[]) => desktop.invoke(`folder.${channel}`, workspaceId, ...args) as Promise<T>;
  return {
    list: () => call("list"),
    readText: (path) => call("readText", path),
    async readFile(path) {
      const { name, bytes, hash } = await call<{ name: string; bytes: Uint8Array<ArrayBuffer>; hash: string }>("readFile", path);
      return { file: new File([bytes], name), hash };
    },
    hashOf: (path) => call("hashOf", path),
    writeText: (path, text) => call("writeText", path, text),
    writeBlob: async (path, blob) => call("writeBytes", path, await toBytes(blob)),
    move: (from, to) => call("move", from, to),
    trash: (path) => call("trash", path),
    saveAside: async (path, content) => call("saveAside", path, typeof content === "string" ? content : await toBytes(content))
  };
}

/** 동기화 상태는 연결 폴더의 .fruition/sync/state.json에 저장된다. */
export function createDesktopStatePort(desktop: DesktopApi, workspaceId: string): SyncStatePort {
  return {
    load: () => desktop.invoke("state.load", workspaceId) as Promise<SyncState>,
    save: async (state) => {
      await desktop.invoke("state.save", workspaceId, state);
    }
  };
}

async function toBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
