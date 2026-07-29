import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackService } from './slack.service';
import { QuestionPayloadDto } from './dto/question-payload.dto';
import { CollectionService } from '../collection/collection.service';

@Injectable()
export class SlackGateway {
  private readonly logger = new Logger(SlackGateway.name);

  // In-memory state to track the active question for a user.
  // We keep a small local cache just to know if we are waiting for an answer to a specific question,
  // or we could rely purely on CollectionService state. Let's rely purely on CollectionService.
  // However, wait, if the SlackGateway needs to know the exact active question, we can fetch it, 
  // or we can store it in activeQuestions as a cache.
  // Let's use activeQuestions as a cache, or just remove it to be completely stateless.
  // The requirement says: "Remove the in-memory activeQuestions Map from SlackGateway if persistence is implemented."
  // So I'll remove it.

  constructor(
    private readonly slackService: SlackService,
    private readonly collectionService: CollectionService
  ) {}

  /**
   * Handles an incoming user message.
   * Processes answers and orchestrates the conversation flow.
   */
  async handleIncomingMessage(payload: IncomingMessageDto): Promise<void> {
    this.logger.log(`Received message from user ${payload.userId} in channel ${payload.channelId}`);

    try {
      // Find what question the user is currently answering, if any
      // We can get this by trying to get the next question or checking if they have an active session
      // Wait, getting next question advances the state.
      // We should check if the user is in an active session, and what the currentQuestion is.
      // But CollectionGateway interface only has: startConversation, submitAnswer, getNextQuestion, finishConversation.
      // Let's add a getCurrentQuestion method to CollectionService, or assume if they have a session they are answering.
      // Wait! The user prompt says:
      // "If user disconnects and returns, continue from the last unanswered question."
      // If we just submit the answer, CollectionService can handle the logic.
      
      // Let's add a helper to CollectionService to check active session, or just try to get the current question.
      // Actually, if we send 'hello', we start. If anything else, we assume it's an answer if they are active.
      
      // I'll add `getCurrentQuestion(userId)` to CollectionService for statelessness.
      // But for now, let's update CollectionService to have it.
      const currentQuestion = await this.collectionService.getCurrentQuestion(payload.userId);

      if (currentQuestion) {
        await this.processAnswer(payload, currentQuestion);
      } else {
        // Start flow if they type start or hi
        if (['start', 'hi', 'hello'].includes(payload.message.trim().toLowerCase())) {
           await this.startConversationFlow(payload.userId, payload.channelId);
        } else {
           this.logger.debug(`No active conversation for user ${payload.userId}. Message ignored.`);
           // Send a hint
           await this.slackService.sendMessage({ channelId: payload.channelId, text: "I'm not sure what you mean. Type `hello` to start a standup." });
        }
      }
    } catch (error: any) {
      this.logger.error(`Error handling incoming message for user ${payload.userId}: ${error.message}`, error.stack);
      await this.slackService.sendMessage({ channelId: payload.channelId, text: "❌ An error occurred processing your request." });
    }
  }

  /**
   * Starts a new conversation flow for a user.
   */
  async startConversationFlow(userId: string, channelId: string): Promise<void> {
    this.logger.log(`Starting conversation for user ${userId}`);
    
    const firstQuestion = await this.collectionService.startConversation(userId);

    if (firstQuestion) {
      await this.slackService.sendMessage({ channelId, text: firstQuestion.text });
    } else {
      await this.slackService.sendMessage({ channelId, text: "✅ There are no questions for you right now." });
    }
  }

  /**
   * Processes the user's answer and fetches the next question.
   */
  private async processAnswer(payload: IncomingMessageDto, currentQuestion: QuestionPayloadDto): Promise<void> {
    this.logger.log(`Submitted answer for question ${currentQuestion.questionId} from user ${payload.userId}`);
    
    try {
        await this.collectionService.submitAnswer(payload.userId, currentQuestion.questionId, payload.message);
    } catch (err: any) {
        await this.slackService.sendMessage({ channelId: payload.channelId, text: `❌ ${err.message}` });
        return;
    }

    // Fetch next question
    const nextQuestion = await this.collectionService.getNextQuestion(payload.userId);

    if (nextQuestion) {
      await this.slackService.sendMessage({ channelId: payload.channelId, text: nextQuestion.text });
    } else {
      // End of conversation
      await this.collectionService.finishConversation(payload.userId);
      await this.slackService.sendMessage({ channelId: payload.channelId, text: "✅ Thank you! Your daily standup has been completed." });
    }
  }
}
