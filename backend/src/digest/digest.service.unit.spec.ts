import { Test, TestingModule } from '@nestjs/testing';
import { DigestService } from './digest.service';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';

function makeResponse(
  overrides: Partial<StandupResponse> = {},
): StandupResponse {
  return {
    userId: 'U001',
    name: 'Alice',
    update: 'Working on feature X',
    submittedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DigestService],
    }).compile();

    service = module.get(DigestService);
  });

  describe('generateDailyDigest', () => {
    describe('empty state', () => {
      it('returns a no-participants message when there are no responses and no non-responders', () => {
        // Arrange
        const responses: StandupResponse[] = [];
        const nonResponders: Array<StandupNonResponder | string> = [];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toBe(
          '*Daily Standup Digest*\n\n_No standup participants found._',
        );
      });

      it('uses an empty non-responders list by default', () => {
        // Arrange
        const responses: StandupResponse[] = [];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('_No standup participants found._');
      });
    });

    describe('responses with no blockers', () => {
      it('lists completed responses and reports no blockers when blocker is omitted', () => {
        // Arrange
        const responses = [makeResponse({ blocker: undefined })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*👤 Alice*');
        expect(digest).toContain('Working on feature X');
        expect(digest).toContain('*🚧 Blockers*\n• None reported.');
        expect(digest).toContain('_Responses received: 1_');
      });

      it('reports no blockers when all responses use sentinel no-blocker values', () => {
        // Arrange
        const responses = [
          makeResponse({ name: 'Alice', blocker: 'none' }),
          makeResponse({ name: 'Bob', blocker: 'N/A' }),
        ];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*🚧 Blockers*\n• None reported.');
        expect(digest).not.toMatch(/• \*Alice:\*/);
        expect(digest).not.toMatch(/• \*Bob:\*/);
      });
    });

    describe('real blockers', () => {
      it('includes a blockers section for genuine blocker descriptions', () => {
        // Arrange
        const responses = [
          makeResponse({
            name: 'Alice',
            blocker: 'Waiting on API access from vendor',
          }),
        ];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*🚧 Blockers*');
        expect(digest).toContain(
          '• *Alice:* Waiting on API access from vendor',
        );
      });

      it('lists blockers from multiple responders separately', () => {
        // Arrange
        const responses = [
          makeResponse({ name: 'Alice', blocker: 'Blocked on review' }),
          makeResponse({ name: 'Bob', blocker: 'CI pipeline failing' }),
        ];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('• *Alice:* Blocked on review');
        expect(digest).toContain('• *Bob:* CI pipeline failing');
      });
    });

    describe('blocker filtering', () => {
      it.each([
        'no',
        'none',
        'no blocker',
        'no blockers',
        'none reported',
        'n/a',
        'na',
        'nothing',
      ])('treats "%s" as not a real blocker', (sentinel) => {
        // Arrange
        const responses = [makeResponse({ blocker: sentinel })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*🚧 Blockers*\n• None reported.');
      });

      it('normalizes blocker sentinel values before filtering (case and whitespace)', () => {
        // Arrange
        const responses = [makeResponse({ blocker: '  NO BLOCKERS  ' })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*🚧 Blockers*\n• None reported.');
      });

      it('treats an empty blocker string as no blocker', () => {
        // Arrange
        const responses = [makeResponse({ blocker: '' })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*🚧 Blockers*\n• None reported.');
      });
    });

    describe('missing participants', () => {
      it('lists string non-responders under the missing-updates section', () => {
        // Arrange
        const responses = [makeResponse()];
        const nonResponders = ['Charlie', 'Dana'];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain('*⏳ No Update Submitted*');
        expect(digest).toContain('• Charlie');
        expect(digest).toContain('• Dana');
        expect(digest).toContain('_Missing responses: 2_');
      });

      it('lists StandupNonResponder objects by display name', () => {
        // Arrange
        const responses = [makeResponse()];
        const nonResponders: StandupNonResponder[] = [
          { userId: 'U002', name: 'Charlie' },
          { userId: 'U003', name: 'Dana' },
        ];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain('• Charlie');
        expect(digest).toContain('• Dana');
        expect(digest).toContain('_Missing responses: 2_');
      });

      it('supports a mix of string and object non-responders', () => {
        // Arrange
        const responses: StandupResponse[] = [];
        const nonResponders: Array<StandupNonResponder | string> = [
          'Charlie',
          { userId: 'U003', name: 'Dana' },
        ];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain('• Charlie');
        expect(digest).toContain('• Dana');
        expect(digest).toContain('_Missing responses: 2_');
      });

      it('shows a no-responses message when only non-responders exist', () => {
        // Arrange
        const responses: StandupResponse[] = [];
        const nonResponders = ['Charlie'];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain(
          '_No completed standup responses were submitted today._',
        );
        expect(digest).toContain('• Charlie');
        expect(digest).toContain('_Responses received: 0_');
      });
    });

    describe('everyone submitted', () => {
      it('reports everyone submitted when there are no missing participants', () => {
        // Arrange
        const responses = [makeResponse(), makeResponse({ name: 'Bob' })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain(
          '*⏳ No Update Submitted*\n• Everyone submitted.',
        );
        expect(digest).not.toContain('_Missing responses:');
      });
    });

    describe('submitted time formatting', () => {
      it('renders Unknown time for an invalid submittedAt value', () => {
        // Arrange
        const responses = [makeResponse({ submittedAt: 'not-a-date' })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('_Submitted: Unknown time_');
      });

      it('includes a formatted submission time for valid ISO timestamps', () => {
        // Arrange
        const localeSpy = jest
          .spyOn(Date.prototype, 'toLocaleString')
          .mockReturnValue('Jan 15, 2024, 1:00 PM');
        const responses = [makeResponse({ submittedAt: '2024-01-15T10:00:00.000Z' })];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('_Submitted: Jan 15, 2024, 1:00 PM_');
        localeSpy.mockRestore();
      });
    });

    describe('multiple responses', () => {
      it('separates each participant update with a blank line', () => {
        // Arrange
        const responses = [
          makeResponse({ name: 'Alice', update: 'Shipped auth fix' }),
          makeResponse({ name: 'Bob', update: 'Reviewing PRs' }),
        ];

        // Act
        const digest = service.generateDailyDigest(responses);

        // Assert
        expect(digest).toContain('*👤 Alice*\nShipped auth fix');
        expect(digest).toContain('*👤 Bob*\nReviewing PRs');
        expect(digest).toMatch(
          /_Submitted: .+\n\n\*👤 Bob\*/,
        );
        expect(digest).toContain('_Responses received: 2_');
      });
    });

    describe('edge cases', () => {
      it('filters blank and whitespace-only non-responder names', () => {
        // Arrange
        const responses = [makeResponse()];
        const nonResponders: Array<StandupNonResponder | string> = [
          '  ',
          '',
          { userId: 'U004', name: '   ' },
          'Valid Name',
        ];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain('• Valid Name');
        expect(digest).toContain('_Missing responses: 1_');
        expect(digest).not.toContain('•  ');
      });

      it('trims surrounding whitespace from string non-responder names', () => {
        // Arrange
        const responses = [makeResponse()];
        const nonResponders = ['  Charlie  '];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain('• Charlie');
        expect(digest).not.toContain('•   Charlie  ');
      });

      it('omits missing name on object non-responders when name is undefined', () => {
        // Arrange
        const responses = [makeResponse()];
        const nonResponders = [
          { userId: 'U005', name: undefined as unknown as string },
        ];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        expect(digest).toContain(
          '*⏳ No Update Submitted*\n• Everyone submitted.',
        );
      });

      it('preserves the digest section order: header, responses, blockers, missing, totals', () => {
        // Arrange
        const responses = [
          makeResponse({ name: 'Alice', blocker: 'Needs design review' }),
        ];
        const nonResponders = ['Charlie'];

        // Act
        const digest = service.generateDailyDigest(responses, nonResponders);

        // Assert
        const headerIndex = digest.indexOf('*Daily Standup Digest*');
        const responseIndex = digest.indexOf('*👤 Alice*');
        const blockersIndex = digest.indexOf('*🚧 Blockers*');
        const missingIndex = digest.indexOf('*⏳ No Update Submitted*');
        const totalsIndex = digest.indexOf('_Responses received:');

        expect(headerIndex).toBeLessThan(responseIndex);
        expect(responseIndex).toBeLessThan(blockersIndex);
        expect(blockersIndex).toBeLessThan(missingIndex);
        expect(missingIndex).toBeLessThan(totalsIndex);
      });
    });
  });
});
