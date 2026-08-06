import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { TeamService } from './team.service';

type CreateTeamBody = {
  workspaceId: string;
  name: string;
  slackChannelId?: string;
  scheduleCron?: string;
  timezone?: string;
  schedulerEnabled?: boolean;
};

type AddTeamMemberBody = {
  userId?: string;
  slackUserId?: string;
  role?: string;
};

@Controller('teams')
export class TeamController {
  constructor(
    private readonly teamService: TeamService,
  ) {}

  @Post()
  createTeam(@Body() body: CreateTeamBody) {
    return this.teamService.createTeam(body);
  }

  @Post(':teamId/members')
  addMember(
    @Param('teamId') teamId: string,
    @Body() body: AddTeamMemberBody,
  ) {
    return this.teamService.addMember({
      teamId,
      ...body,
    });
  }

  @Get()
  getTeams() {
    return this.teamService.getTeams();
  }

  @Get(':teamId')
  getTeam(@Param('teamId') teamId: string) {
    return this.teamService.getTeam(teamId);
  }
}