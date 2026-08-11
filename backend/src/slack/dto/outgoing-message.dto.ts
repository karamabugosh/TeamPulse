export class OutgoingMessageDto {
  channelId: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}
