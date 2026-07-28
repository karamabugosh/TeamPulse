import { Injectable } from '@nestjs/common';
import { DigestService } from '../digest/digest.service';

@Injectable()
export class SchedulerService {
  constructor(private readonly digestService: DigestService) {}

  runDailyDigest() {
    const sampleResponses = [
      {
        name: 'Ghassan',
        update: 'Completed the scheduling setup',
        blocker: 'Waiting for Slack integration',
      },
      {
        name: 'Intern 2',
        update: 'Finished the response model',
      },
    ];

    return {
      status: 'success',
      digest: this.digestService.generateDailyDigest(sampleResponses),
      generatedAt: new Date().toISOString(),
    };
  }
}