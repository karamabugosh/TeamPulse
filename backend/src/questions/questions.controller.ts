import { Controller, Get, Post, Put, Delete, Patch, Body, Param } from '@nestjs/common';
import { QuestionsService } from './questions.service';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  findAll() {
    return this.questionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  @Post()
  create(@Body() data: { question: string; order: number; isActive?: boolean }) {
    return this.questionsService.create(data);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: { question?: string; order?: number; isActive?: boolean }) {
    return this.questionsService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.questionsService.remove(id);
  }

  @Patch('reorder')
  reorder(@Body() data: { updates: { id: string; order: number }[] }) {
    return this.questionsService.reorder(data.updates);
  }

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.questionsService.toggleActive(id);
  }
}
