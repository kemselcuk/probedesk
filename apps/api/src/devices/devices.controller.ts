import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import { DeviceRevisionDto } from './dto/device-revision.dto.js';
import { DeviceDto, DeviceListResponseDto } from './dto/device.dto.js';
import {
  DEFAULT_DEVICE_LIMIT,
  DEFAULT_DEVICE_PAGE,
  DEVICE_STATE_FILTERS,
  MAX_DEVICE_LIMIT,
  MAX_DEVICE_SEARCH_LENGTH,
  ListDevicesQueryDto,
} from './dto/list-devices-query.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';
import { DevicesService } from './devices.service.js';

@ApiTags('devices')
@ApiExtraModels(ApiErrorDto)
@Controller('devices')
@UseGuards(SessionAuthGuard, RolesGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'List devices with prefix search, state filter and pagination.',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    schema: { type: 'string', maxLength: MAX_DEVICE_SEARCH_LENGTH },
    description:
      'Case-insensitive prefix search over name and serial number. Wildcards are literal.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    schema: {
      type: 'string',
      enum: [...DEVICE_STATE_FILTERS],
      default: 'active',
    },
    description: 'Active devices only, archived devices only, or all devices.',
  })
  @ApiQuery({
    name: 'deviceProfileId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only devices of this profile. An unknown id returns an empty page.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      default: DEFAULT_DEVICE_PAGE,
    },
    description: '1-based page number.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_DEVICE_LIMIT,
      default: DEFAULT_DEVICE_LIMIT,
    },
    description: `Page size. Defaults to ${DEFAULT_DEVICE_LIMIT} and must not exceed ${MAX_DEVICE_LIMIT}.`,
  })
  @ApiOkResponse({
    description:
      'A page ordered by name ASC, id ASC. Archived rows are excluded unless requested.',
    type: DeviceListResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'A filter, page or limit is malformed or an unknown query parameter was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  list(@Query() query: ListDevicesQueryDto): Promise<DeviceListResponseDto> {
    return this.devicesService.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary: 'Create a device record with a canonical unique serial number.',
  })
  @ApiCreatedResponse({
    description:
      'The new active device. The serial display case is preserved while uniqueness is case-insensitive inside the profile.',
    type: DeviceDto,
  })
  @ApiBody({ type: CreateDeviceDto })
  @ApiBadRequestResponse({
    description:
      'A field is missing, invalid or unknown, or deviceProfileId does not reference an existing profile.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'DEVICE_SERIAL_CONFLICT when the canonical serial number already exists in the profile. No row was created.',
    type: ApiErrorDto,
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreateDeviceDto,
  ): Promise<DeviceDto> {
    return this.devicesService.create(auth.user.id, body);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Read the current device record with revision and archive state.',
  })
  @ApiOkResponse({
    description: 'The current device row. Archived devices remain readable.',
    type: DeviceDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The device does not exist.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Device id.',
  })
  getById(@Param('id', new ParseUUIDPipe()) id: string): Promise<DeviceDto> {
    return this.devicesService.findById(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Update mutable device fields with an optimistic revision check. The profile is fixed.',
  })
  @ApiOkResponse({
    description:
      'The updated device. An unchanged payload returns the current row without incrementing the revision.',
    type: DeviceDto,
  })
  @ApiBody({ type: UpdateDeviceDto })
  @ApiBadRequestResponse({
    description:
      'expectedRevision or a changed field is invalid, deviceProfileId was supplied, or another unknown field was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The device does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'DEVICE_CONFLICT for a stale editRevision, or DEVICE_SERIAL_CONFLICT when another device owns the canonical serial number. Nothing was changed.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Device id.',
  })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateDeviceDto,
  ): Promise<DeviceDto> {
    return this.devicesService.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Archive a device without deleting its history. Archiving an archived row is a no-op after the revision check.',
  })
  @ApiOkResponse({
    description:
      'The archived device. When the target state already holds and expectedRevision matches, the revision is unchanged.',
    type: DeviceDto,
  })
  @ApiBody({ type: DeviceRevisionDto })
  @ApiBadRequestResponse({
    description: 'expectedRevision is missing or invalid.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The device does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'DEVICE_CONFLICT for a stale editRevision, even when the device is already archived.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Device id.',
  })
  archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeviceRevisionDto,
  ): Promise<DeviceDto> {
    return this.devicesService.archive(id, body.expectedRevision);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Restore an archived device to active use. Restoring an active row is a no-op after the revision check.',
  })
  @ApiOkResponse({
    description:
      'The active device. When it was already active and expectedRevision matches, the revision is unchanged.',
    type: DeviceDto,
  })
  @ApiBody({ type: DeviceRevisionDto })
  @ApiBadRequestResponse({
    description: 'expectedRevision is missing or invalid.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The device does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'DEVICE_CONFLICT for a stale editRevision, even when the device is already active.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Device id.',
  })
  restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DeviceRevisionDto,
  ): Promise<DeviceDto> {
    return this.devicesService.restore(id, body.expectedRevision);
  }
}
