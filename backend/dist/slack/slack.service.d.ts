import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';
export declare class SlackService implements OnModuleInit, OnModuleDestroy {
    private readonly configService;
    private readonly logger;
    private app?;
    constructor(configService: ConfigService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private initializeSlack;
    getSlackApp(): App | undefined;
    sendMessage(payload: OutgoingMessageDto): Promise<void>;
}
