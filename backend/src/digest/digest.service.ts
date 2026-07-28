import { Injectable } from '@nestjs/common';

type StandupResponse = {
  name: string;
  update: string;
  blocker?: string;
};

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