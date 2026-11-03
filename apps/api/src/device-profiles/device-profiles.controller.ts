import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { DeviceProfilesService } from './device-profiles.service.js';
import { DeviceProfileDto } from './dto/device-profile.dto.js';

@ApiTags('device-profiles')
@ApiExtraModels(ApiErrorDto)
@ApiSecurity('session')
@Controller('device-profiles')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
export class DeviceProfilesController {
  constructor(
    private readonly deviceProfilesService: DeviceProfilesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List the available simulated device profiles.' })
  @ApiOkResponse({
    description:
      'Every available profile. The initial product seeds one DC Power Module profile.',
    type: [DeviceProfileDto],
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  list(): Promise<DeviceProfileDto[]> {
    return this.deviceProfilesService.list();
  }
}
