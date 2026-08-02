import { PrismaService } from '../prisma/prisma.service';
export declare class QuestionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    toggleActive(id: string): Promise<{
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
    reorder(updates: {
        id: string;
        order: number;
    }[]): Promise<{
        question: string;
        id: string;
        order: number;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    private validateQuestion;
    private validateOrderUnique;
}
