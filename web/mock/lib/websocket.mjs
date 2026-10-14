// 의존성 없는 최소 WebSocket 서버(RFC 6455). mock의 회의 실시간 받아쓰기(#148)만 쓴다.
// 텍스트·바이너리 frame, 조각 frame 이어 붙이기, ping/pong, close만 다룬다. 압축 확장은 협상하지 않는다.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** upgrade 요청을 거절한다. 브라우저에는 handshake 실패(close 1006)로 보인다. */
export function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** upgrade 요청을 받아들이고 연결 객체를 돌려준다. message(data: Buffer, isBinary), close(code) 이벤트를 낸다. */
export function acceptWebSocket(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(`${key}${HANDSHAKE_GUID}`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
  socket.setNoDelay(true);

  const connection = new EventEmitter();
  let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = 0;
  let closed = false;

  function writeFrame(opcode, payload) {
    if (closed || socket.destroyed) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65_536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  function finishClose(code) {
    if (closed) return;
    closed = true;
    socket.end();
    connection.emit("close", code);
  }

  connection.readyState = () => (closed ? 3 : 1);
  connection.send = (data) => {
    if (typeof data === "string") writeFrame(0x1, Buffer.from(data, "utf8"));
    else writeFrame(0x2, Buffer.from(data));
  };
  connection.sendJson = (value) => connection.send(JSON.stringify(value));
  connection.close = (code = 1000, reason = "") => {
    if (closed) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    writeFrame(0x8, payload);
    finishClose(code);
  };

  function handleFrame(opcode, isFinal, payload) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      // 상대 close에 같은 코드로 답하고 닫는다.
      if (!closed) writeFrame(0x8, payload.subarray(0, 2));
      finishClose(code);
      return;
    }
    if (opcode === 0x9) return writeFrame(0xa, payload);
    if (opcode === 0xa) return;
    if (opcode !== 0x0) fragmentOpcode = opcode;
    fragments.push(payload);
    if (!isFinal) return;
    const data = Buffer.concat(fragments);
    fragments = [];
    connection.emit("message", data, fragmentOpcode === 0x2);
  }

  function parse() {
    while (buffer.length >= 2) {
      const isFinal = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const isMasked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskOffset = offset;
      if (isMasked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (isMasked) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= buffer[maskOffset + (index % 4)];
      }
      buffer = buffer.subarray(offset + length);
      handleFrame(opcode, isFinal, payload);
    }
  }

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parse();
  });
  socket.on("close", () => finishClose(1006));
  socket.on("error", () => finishClose(1006));
  if (buffer.length > 0) setImmediate(parse);
  return connection;
}
