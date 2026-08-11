export class IncomingMessageDto {
  userId: string;
  channelId: string;
  message: string;
  timestamp: string;
  threadTs?: string;
}
