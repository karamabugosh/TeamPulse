import { Injectable } from '@nestjs/common';
import { StandupResponse } from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(responses: StandupResponse[]): string {
    if (responses.length === 0) {
      return [
        '*Daily Standup Digest*',
        '',
        '_No completed standup responses were submitted._',
      ].join('\n');
    }

    const responseSections = responses
      .map((response) => this.formatResponse(response))
      .join('\n\n');

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

    return [
      '*Daily Standup Digest*',
      '',
      responseSections,
      '',
      blockerSection,
      '',
      `_Responses received: ${responses.length}_`,
    ].join('\n');
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