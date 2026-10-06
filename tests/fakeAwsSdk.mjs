// @aws-sdk/client-eventbridge·client-dynamodb 대역. 테스트가 registerHooks로 이 파일을 대신 해석시킨다.
// 보낸 명령은 sent에 쌓이고, 응답·오류는 fake.respond로 바꾼다.
export const fake = {
  sent: [],
  respond: () => ({}),
  reset() {
    this.sent = [];
    this.respond = () => ({});
  }
};

class FakeClient {
  async send(command) {
    fake.sent.push(command);
    return fake.respond(command);
  }
}

class FakeCommand {
  constructor(input) {
    this.input = input;
  }
}

export class EventBridgeClient extends FakeClient {}
export class DynamoDBClient extends FakeClient {}
export class PutEventsCommand extends FakeCommand {}
export class GetItemCommand extends FakeCommand {}
