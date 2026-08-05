import { Injectable } from '@nestjs/common';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(
    responses: StandupResponse[],
    nonResponders: StandupNonResponder[] = [],
  ): string {
    const sections: string[] = [
      '*Daily Standup Digest*',
      '',
    ];

    if (responses.length === 0) {
      sections.push(
        '_No completed standup responses were submitted._',
      );
    } else {
      sections.push(
        responses
          .map((response) =>
            this.formatResponse(response),
          )
          .join('\n\n'),
      );
    }

    const blockerResponses = responses.filter(
      (response) =>
        response.blocker &&
        !this.isNoBlockerResponse(response.blocker),
    );

    sections.push('');

    if (blockerResponses.length > 0) {
      sections.push(
        [
          '*🚧 Blockers*',
          ...blockerResponses.map(
            (response) =>
              `• *${response.name}:* ${response.blocker}`,
          ),
        ].join('\n'),
      );
    } else {
      sections.push('*🚧 Blockers*\n• None reported.');
    }

    sections.push('');

    if (nonResponders.length > 0) {
      sections.push(
        [
          '*⏳ No Response*',
          ...nonResponders.map(
            (member) => `• ${member.name}`,
          ),
        ].join('\n'),
      );
    } else {
      sections.push(
        '*⏳ No Response*\n• Everyone submitted.',
      );
    }

    sections.push('');
    sections.push(
      `_Responses received: ${responses.length}_`,
    );

    if (nonResponders.length > 0) {
      sections.push(
        `_Missing responses: ${nonResponders.length}_`,
      );
    }

    return sections.join('\n');
  }

  private formatResponse(
    response: StandupResponse,
  ): string {
    const submittedTime = this.formatSubmittedTime(
      response.submittedAt,
    );

    return [
      `*👤 ${response.name}*`,
      response.update,
      `_Submitted: ${submittedTime}_`,
    ].join('\n');
  }

  private isNoBlockerResponse(
    blocker: string,
  ): boolean {
    const normalized = blocker.trim().toLowerCase();

    return [
      'no',
      'none',
      'no blocker',
      'no blockers',
      'none reported',
      'n/a',
      'na',
    ].includes(normalized);
  }

  private formatSubmittedTime(
    submittedAt: string,
  ): string {
    const date = new Date(submittedAt);

    if (Number.isNaN(date.getTime())) {
      return 'Unknown time';
    }

    return date.toLocaleString('en-US', {
      timeZone: 'Asia/Riyadh',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }
}