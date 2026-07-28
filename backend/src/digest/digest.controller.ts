import { Body, Controller, Post } from '@nestjs/common';
import { DigestService } from './digest.service';

@Controller('digest')
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  @Post('daily')
  generateDailyDigest(
    @Body()
    responses: {
      name: string;
      update: string;
      blocker?: string;
    }[],
  ) {
    return {
      digest: this.digestService.generateDailyDigest(responses),
    };
  }
}