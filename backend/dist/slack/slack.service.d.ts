export declare class SlackService {
    private readonly logger;
    sendMessage(botToken: string, channelId: string, text: string): Promise<void>;
}
