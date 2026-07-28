type StandupResponse = {
    name: string;
    update: string;
    blocker?: string;
};
export declare class DigestService {
    generateDailyDigest(responses: StandupResponse[]): string;
}
export {};
