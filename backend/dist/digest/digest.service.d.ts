import { StandupResponse } from '../common/types/standup-response.type';
export declare class DigestService {
    generateDailyDigest(responses: StandupResponse[]): string;
}
