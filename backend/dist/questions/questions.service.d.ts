import { PrismaService } from '../prisma/prisma.service';
export declare class QuestionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
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
    toggleActive(id: string): Promise<{
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
    reorder(updates: {
        id: string;
        order: number;
    }[]): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        question: string;
        order: number;
        isActive: boolean;
    }[]>;
    private validateQuestion;
    private validateOrderUnique;
}
