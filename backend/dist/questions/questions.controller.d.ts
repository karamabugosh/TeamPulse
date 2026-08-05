import { QuestionsService } from './questions.service';
export declare class QuestionsController {
    private readonly questionsService;
    constructor(questionsService: QuestionsService);
    findAll(): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }>;
    create(data: {
        question: string;
        order: number;
        isActive?: boolean;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }>;
    update(id: string, data: {
        question?: string;
        order?: number;
        isActive?: boolean;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }>;
    remove(id: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }>;
    reorder(data: {
        updates: {
            id: string;
            order: number;
        }[];
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }[]>;
    toggleActive(id: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }>;
}
