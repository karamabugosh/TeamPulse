import { DigestService } from './digest.service';
export declare class DigestController {
    private readonly digestService;
    constructor(digestService: DigestService);
    generateDailyDigest(responses: {
        name: string;
        update: string;
        blocker?: string;
    }[]): {
        digest: string;
    };
}
