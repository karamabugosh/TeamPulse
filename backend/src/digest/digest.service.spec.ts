import { DigestService } from './digest.service';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(() => {
    service = new DigestService();
  });

  it('formats a completed standup response', () => {
    const responses: StandupResponse[] = [
      {
        userId: 'U123',
        name: 'Ghassan',
        update:
          '*What did you work on today?*\nTesting the scheduler\n' +
          '*What are you planning to work on next?*\nAdding tests',
        blocker: 'No blockers',
        submittedAt: '2026-08-05T10:00:00.000Z',
      },
    ];

    const result = service.generateDailyDigest(responses);

    expect(result).toContain('*Daily Standup Digest*');
    expect(result).toContain('*👤 Ghassan*');
    expect(result).toContain('Testing the scheduler');
    expect(result).toContain('Adding tests');
    expect(result).toContain('*🚧 Blockers*');
    expect(result).toContain('• None reported.');
    expect(result).toContain('_Responses received: 1_');
  });

  it('shows a real blocker', () => {
    const responses: StandupResponse[] = [
      {
        userId: 'U123',
        name: 'Ghassan',
        update: 'Completed scheduler work',
        blocker: 'Waiting for Slack permissions',
        submittedAt: '2026-08-05T10:00:00.000Z',
      },
    ];

    const result = service.generateDailyDigest(responses);

    expect(result).toContain(
      '• *Ghassan:* Waiting for Slack permissions',
    );
  });

  it.each([
    'no',
    'none',
    'no blocker',
    'no blockers',
    'none reported',
    'n/a',
    'na',
  ])(
    'treats "%s" as no blocker',
    (blockerResponse) => {
      const responses: StandupResponse[] = [
        {
          userId: 'U123',
          name: 'Ghassan',
          update: 'Test update',
          blocker: blockerResponse,
          submittedAt: '2026-08-05T10:00:00.000Z',
        },
      ];

      const result =
        service.generateDailyDigest(responses);

      expect(result).toContain('• None reported.');
      expect(result).not.toContain(
        `• *Ghassan:* ${blockerResponse}`,
      );
    },
  );

  it('shows non-responders', () => {
    const responses: StandupResponse[] = [
      {
        userId: 'U123',
        name: 'Ghassan',
        update: 'Test update',
        submittedAt: '2026-08-05T10:00:00.000Z',
      },
    ];

    const nonResponders: StandupNonResponder[] = [
      {
        userId: 'U456',
        name: 'Intern 2',
      },
      {
        userId: 'U789',
        name: 'Intern 3',
      },
    ];

    const result = service.generateDailyDigest(
      responses,
      nonResponders,
    );

    expect(result).toContain('*⏳ No Response*');
    expect(result).toContain('• Intern 2');
    expect(result).toContain('• Intern 3');
    expect(result).toContain('_Missing responses: 2_');
  });

  it('shows that everyone submitted when there are no non-responders', () => {
    const responses: StandupResponse[] = [
      {
        userId: 'U123',
        name: 'Ghassan',
        update: 'Test update',
        submittedAt: '2026-08-05T10:00:00.000Z',
      },
    ];

    const result = service.generateDailyDigest(
      responses,
      [],
    );

    expect(result).toContain(
      '*⏳ No Response*\n• Everyone submitted.',
    );
    expect(result).not.toContain(
      '_Missing responses:',
    );
  });

  it('handles an empty response list', () => {
    const result = service.generateDailyDigest([]);

    expect(result).toContain(
      '_No completed standup responses were submitted._',
    );
    expect(result).toContain('• None reported.');
    expect(result).toContain(
      '• Everyone submitted.',
    );
    expect(result).toContain('_Responses received: 0_');
  });

  it('handles an invalid submission date safely', () => {
    const responses: StandupResponse[] = [
      {
        userId: 'U123',
        name: 'Ghassan',
        update: 'Test update',
        submittedAt: 'not-a-valid-date',
      },
    ];

    const result = service.generateDailyDigest(responses);

    expect(result).toContain(
      '_Submitted: Unknown time_',
    );
  });
});