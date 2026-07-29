import { QuestionsService } from './questions.service';
export declare class QuestionsController {
    private readonly questionsService;
    constructor(questionsService: QuestionsService);
    findAll(): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    findOne(id: string): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    create(data: {
        question: string;
        order: number;
        isActive?: boolean;
    }): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    update(id: string, data: {
        question?: string;
        order?: number;
        isActive?: boolean;
    }): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(id: string): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    reorder(data: {
        updates: {
            id: string;
            order: number;
        }[];
    }): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    toggleActive(id: string): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
