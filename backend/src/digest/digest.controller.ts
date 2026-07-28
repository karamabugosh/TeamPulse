import { Body, Controller, Post } from '@nestjs/common';
import { StandupResponse } from '../common/types/standup-response.type';
import { DigestService } from './digest.service';

@Controller('digest')
export class DigestController {
  constructor(private readonly digestService: DigestService) {}

  @Post('daily')
  generateDailyDigest(@Body() responses: StandupResponse[]) {
    return {
      digest: this.digestService.generateDailyDigest(responses),
    };
  }
}