import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { readSessionToken } from '../auth/cookie.js';
import { ApiException } from '../common/errors/api.exception.js';
import { getRequestId } from '../common/http/request-id.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { RunEventEnvelopeDto } from './dto/run-event-envelope.dto.js';
import { RUN_EVENT_WIRE_TYPE_NAMES } from './run-event-stream.js';
import { RunEventsService } from './run-events.service.js';

const STREAM_DESCRIPTION = [
  'Server-Sent Events over committed RunEvent rows.',
  '',
  'Frames use `id:` = run-local sequence, `event:` = one of',
  `(${RUN_EVENT_WIRE_TYPE_NAMES.join(', ')}) and \`data:\` = the`,
  'RunEventEnvelopeDto JSON envelope.',
  '',
  'Replay sends only events newer than the cursor in strict sequence order and',
  'then follows the same table. A `: heartbeat` comment is sent every 15 seconds',
  'and consumes no domain sequence. A terminal event is always the last frame,',
  'after which the server closes the connection.',
].join('\n');

@ApiTags('runs')
@ApiExtraModels(ApiErrorDto, RunEventEnvelopeDto)
@Controller('runs')
@UseGuards(SessionAuthGuard, RolesGuard)
export class RunEventsController {
  constructor(
    @Inject(RunEventsService)
    private readonly runEventsService: RunEventsService,
  ) {}

  @Get(':id/events')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary:
      'Replay and follow the committed run event stream as Server-Sent Events.',
    description: STREAM_DESCRIPTION,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Run id.',
  })
  @ApiQuery({
    name: 'after',
    required: false,
    schema: { type: 'integer', minimum: 0, default: 0, example: 0 },
    description:
      'Last sequence already applied by the client. Ignored when Last-Event-ID is present. Defaults to 0.',
  })
  @ApiHeader({
    name: 'Last-Event-ID',
    required: false,
    description:
      'EventSource reconnect cursor. Takes precedence over ?after= when present and must be a non-negative integer.',
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiOkResponse({
    description: STREAM_DESCRIPTION,
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          description:
            'UTF-8 SSE frames separated by blank lines. The data field is a RunEventEnvelopeDto; the event field is the run event wire name.',
        },
        example:
          'id: 7\nevent: measurement.recorded\ndata: {"schemaVersion":1,"runId":"6b6f0a1e-2b64-4e9d-9b8d-0fbe7e75a0c4","sequence":7,"occurredAt":"2026-11-03T12:00:00.000Z","payload":{"stepId":"d7e1ad9a-1d3c-4b8a-9c1e-5f3a7c2b8d40","sampleIndex":1,"value":"5.000000","isWithinTolerance":true}}\n\n: heartbeat\n\n',
      },
    },
  })
  @ApiNoContentResponse({
    description:
      'The run is already terminal and no committed event is newer than the cursor. No stream is opened; EventSource stops reconnecting.',
  })
  @ApiBadRequestResponse({
    description:
      'The cursor is negative, malformed, ahead of the run last event sequence, or an unknown query parameter was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The run does not exist.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description:
      'The per-user or per-process active stream limit is reached. No stream was opened.',
    type: ApiErrorDto,
  })
  async stream(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Run existence and cursor validation happen before any SSE header. All
    // failures therefore use the normal JSON error body and request id.
    const prepared = await this.runEventsService.prepare(id, {
      lastEventId: request.headers['last-event-id'],
      after: request.query.after,
      queryKeys: Object.keys(request.query),
    });

    if (prepared === null) {
      response.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    const sessionToken = readSessionToken(request);
    if (!sessionToken) {
      // The guard already proved a session existed; this only closes a window
      // where the cookie disappeared between the guard and the stream start.
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Authentication is required.',
      );
    }

    this.runEventsService.start(prepared, {
      userId: auth.user.id,
      sessionToken,
      sessionExpiresAt: auth.expiresAt,
      request,
      response,
      requestId: getRequestId(request),
    });
  }
}
