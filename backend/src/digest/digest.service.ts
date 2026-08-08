import { Injectable } from '@nestjs/common';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';

@Injectable()
export class DigestService {
  generateDailyDigest(
    responses: StandupResponse[],
    nonResponders: Array<StandupNonResponder | string> = [],
  ): string {
    const sections: string[] = [
      '*Daily Standup Digest*',
      '',
    ];

    /*
     * Support both integrations:
     *
     * - Feature flow that provides StandupNonResponder objects.
     * - Existing scheduling flow that provides participant names as strings.
     */
    const nonResponderNames = nonResponders
      .map((member) =>
        typeof member === 'string'
          ? member.trim()
          : member.name?.trim(),
      )
      .filter(
        (name): name is string =>
          Boolean(name),
      );

    if (
      responses.length === 0 &&
      nonResponderNames.length === 0
    ) {
      return [
        '*Daily Standup Digest*',
        '',
        '_No standup participants found._',
      ].join('\n');
    }

    /*
     * Completed responses
     */
    if (responses.length === 0) {
      sections.push(
        '_No completed standup responses were submitted today._',
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

    /*
     * Blockers
     */
    const blockerResponses = responses.filter(
      (response) =>
        response.blocker &&
        !this.isNoBlockerResponse(
          response.blocker,
        ),
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
      sections.push(
        '*🚧 Blockers*\n• None reported.',
      );
    }

    /*
     * Missing responses
     */
    sections.push('');

    if (nonResponderNames.length > 0) {
      sections.push(
        [
          '*⏳ No Update Submitted*',
          ...nonResponderNames.map(
            (name) => `• ${name}`,
          ),
        ].join('\n'),
      );
    } else {
      sections.push(
        '*⏳ No Update Submitted*\n• Everyone submitted.',
      );
    }

    /*
     * Totals
     */
    sections.push('');
    sections.push(
      `_Responses received: ${responses.length}_`,
    );

    if (nonResponderNames.length > 0) {
      sections.push(
        `_Missing responses: ${nonResponderNames.length}_`,
      );
    }

    return sections.join('\n');
  }

  private formatResponse(
    response: StandupResponse,
  ): string {
    const submittedTime =
      this.formatSubmittedTime(
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
    const normalized = blocker
      .trim()
      .toLowerCase();

    return [
      'no',
      'none',
      'no blocker',
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
    const date = new Date(
      submittedAt,
    );

    if (
      Number.isNaN(date.getTime())
    ) {
      return 'Unknown time';
    }

    return date.toLocaleString(
      'en-US',
      {
        timeZone: 'Asia/Riyadh',
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    );
  }
}