import { DigestService } from './digest.service';

describe('DigestService', () => {
  let service: DigestService;

  beforeEach(() => {
    service = new DigestService();
  });

  it('returns a clear message when there are no responses', () => {
    expect(service.generateDailyDigest([])).toContain(
      'No updates were submitted.',
    );
  });

  it('includes normal updates', () => {
    const result = service.generateDailyDigest([
      {
        userId: '1',
        name: 'Ghassan',
        update: 'Finished scheduler work',
        submittedAt: new Date().toISOString(),
      },
    ]);

    expect(result).toContain('Ghassan');
    expect(result).toContain('Finished scheduler work');
  });

  it('separates blockers', () => {
    const result = service.generateDailyDigest([
      {
        userId: '1',
        name: 'Ghassan',
        update: 'Finished scheduler work',
        blocker: 'Waiting for Slack integration',
        submittedAt: new Date().toISOString(),
      },
    ]);

    expect(result).toContain('*Blockers*');
    expect(result).toContain('Waiting for Slack integration');
  });
});