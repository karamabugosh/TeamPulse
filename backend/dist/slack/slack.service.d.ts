import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';
export declare class SlackService implements OnModuleInit, OnModuleDestroy {
    private readonly configService;
    private readonly prisma;
    private readonly logger;
    private app?;
    constructor(configService: ConfigService, prisma: PrismaService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private initializeSlack;
    getSlackApp(): App | undefined;
    ensureUserRegistered(slackUserId: string): Promise<string>;
    getUserDisplayName(slackUserId: string): Promise<string>;
    sendMessage(payload: OutgoingMessageDto): Promise<boolean>;
}
