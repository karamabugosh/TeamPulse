export class OutgoingMessageDto {
  channelId: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
  /** Optional label for structured logging (e.g. question id). */
  debugContext?: string;
}
