import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackService } from './slack.service';
import { CollectionService } from '../collection/collection.service';
export declare class SlackGateway {
    private readonly slackService;
    private readonly collectionService;
    private readonly logger;
    constructor(slackService: SlackService, collectionService: CollectionService);
    handleIncomingMessage(payload: IncomingMessageDto): Promise<void>;
    startConversationFlow(userId: string, channelId: string): Promise<void>;
    private processAnswer;
}
