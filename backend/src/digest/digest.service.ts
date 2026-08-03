import { Injectable } from '@nestjs/common';
import { StandupResponse } from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(
    responses: StandupResponse[],
    noUpdateUsers: string[] = [],
  ): string {
    const header = '*Daily Standup Digest*';

    if (responses.length === 0 && noUpdateUsers.length === 0) {
      return [
        header,
        '',
        '_No standup participants found._',
      ].join('\n');
    }

    const responseSections =
      responses.length > 0
        ? responses
            .map((response) => this.formatResponse(response))
            .join('\n\n')
        : '_No completed standup responses were submitted today._';

    const blockerResponses = responses.filter(
      (response) =>
        response.blocker &&
        !this.isNoBlockerResponse(response.blocker),
    );

    const blockerSection =
      blockerResponses.length > 0
        ? [
            '*🚧 Blockers*',
            ...blockerResponses.map(
              (response) =>
                `• *${response.name}:* ${response.blocker}`,
            ),
          ].join('\n')
        : '*🚧 Blockers*\n• None reported.';

    const noUpdateSection =
      noUpdateUsers.length > 0
        ? [
            '*⏳ No Update Submitted*',
            ...noUpdateUsers.map((name) => `• ${name}`),
          ].join('\n')
        : '';

    const parts = [
      header,
      '',
      responseSections,
      '',
      blockerSection,
    ];

    if (noUpdateSection) {
      parts.push('', noUpdateSection);
    }

    return parts.join('\n');
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

  private isNoBlockerResponse(blocker: string): boolean {
    const normalized = blocker.trim().toLowerCase();

    return [
      'no',
      'none',
      'no blockers',
      'none reported',
      'n/a',
      'na',
      'nothing',
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