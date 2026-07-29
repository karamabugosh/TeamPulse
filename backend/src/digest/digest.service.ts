import { Injectable } from '@nestjs/common';
import { StandupResponse } from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(responses: StandupResponse[]): string {
    if (responses.length === 0) {
      return '*Daily Standup Digest*\n\nNo updates were submitted.';
    }

    const updates = responses
      .map((response) => `*${response.name}*\n${response.update}`)
      .join('\n\n');

    const blockers = responses
      .filter((response) => response.blocker)
      .map((response) => `• *${response.name}:* ${response.blocker}`)
      .join('\n');

    const blockerSection = blockers
      ? `\n\n*Blockers*\n${blockers}`
      : '\n\n*Blockers*\nNone reported.';

    return `*Daily Standup Digest*\n\n${updates}${blockerSection}`;
  }
}