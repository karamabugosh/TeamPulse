import type { AppHomeSummary } from '../collection/collection.service';
export declare function buildAppHomeBlocks(summary: AppHomeSummary): ({
    type: string;
    text: {
        type: string;
        text: string;
        emoji: boolean;
    };
    fields?: undefined;
    accessory?: undefined;
    elements?: undefined;
} | {
    type: string;
    text: {
        type: string;
        text: string;
        emoji?: undefined;
    };
    fields?: undefined;
    accessory?: undefined;
    elements?: undefined;
} | {
    type: string;
    fields: {
        type: string;
        text: string;
    }[];
    text?: undefined;
    accessory?: undefined;
    elements?: undefined;
} | {
    type: string;
    text?: undefined;
    fields?: undefined;
    accessory?: undefined;
    elements?: undefined;
} | {
    type: string;
    text: {
        type: string;
        text: string;
        emoji?: undefined;
    };
    accessory: {
        type: string;
        text: {
            type: string;
            text: string;
            emoji: boolean;
        };
        action_id: string;
        style: string;
    };
    fields?: undefined;
    elements?: undefined;
} | {
    type: string;
    elements: {
        type: string;
        text: string;
    }[];
    text?: undefined;
    fields?: undefined;
    accessory?: undefined;
})[];
