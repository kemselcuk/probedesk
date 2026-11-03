import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@ApiExtraModels(ApiErrorDto)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Report that the API process is alive.' })
  @ApiOkResponse({
    description:
      'The process is running. This probe does not touch the database.',
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', example: 'ok' },
      },
    },
  })
  live(): { status: 'ok' } {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Report whether the API can serve requests, including database access, applied migrations and startup recovery.',
  })
  @ApiOkResponse({
    description:
      'The database is reachable, every registered migration has finished and leftover running runs have been reconciled.',
    schema: {
      type: 'object',
      required: ['status', 'checks'],
      properties: {
        status: { type: 'string', example: 'ok' },
        checks: {
          type: 'object',
          required: ['database', 'migrations'],
          properties: {
            database: { type: 'string', example: 'ok' },
            migrations: { type: 'string', example: 'ok' },
          },
        },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description:
      'The database is unavailable, its migrations are unfinished or startup recovery is incomplete; retry after it recovers.',
    type: ApiErrorDto,
  })
  ready(): Promise<{
    status: 'ok';
    checks: { database: 'ok'; migrations: 'ok' };
  }> {
    return this.healthService.getReadiness();
  }
}
