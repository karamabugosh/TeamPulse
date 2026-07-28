import { Injectable } from '@nestjs/common';
import { StandupResponse } from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(responses: StandupResponse[]): string {
    const updates = responses
      .map((response) => {
        const blockerText = response.blocker
          ? `\nBlocker: ${response.blocker}`
          : '';

        return `*${response.name}*\n${response.update}${blockerText}`;
      })
      .join('\n\n');

    return `*Daily Standup Digest*\n\n${updates}`;
  }
}