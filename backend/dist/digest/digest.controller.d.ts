import { StandupResponse } from '../common/types/standup-response.type';
import { DigestService } from './digest.service';
export declare class DigestController {
    private readonly digestService;
    constructor(digestService: DigestService);
    generateDailyDigest(responses: StandupResponse[]): {
        digest: string;
    };
}
