import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import {
  ReportExportFormat,
  ReportExportQueryDto,
  RunReportDto,
} from './dto/run-report.dto.js';
import {
  REPORT_CSV_CONTENT_TYPE,
  REPORT_JSON_CONTENT_TYPE,
  serialiseRunReportCsv,
} from './report-csv.js';
import { ReportsService } from './reports.service.js';

const SAFE_RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@ApiTags('reports')
@ApiExtraModels(ApiErrorDto, RunReportDto)
@Controller('runs')
@UseGuards(SessionAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get(':id/report')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary:
      'Read the versioned report projection of a terminal run from its immutable snapshot.',
  })
  @ApiOkResponse({
    description:
      'One consistent projection of the terminal run, its copied step rules, stored statistics and recorded samples. schemaVersion is 1. A RUNNING run is rejected with RUN_NOT_TERMINAL; COMPLETED, CANCELLED, INTERRUPTED and ERROR are readable, including partial and empty data.',
    type: RunReportDto,
  })
  @ApiBadRequestResponse({
    description: 'The run id is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user does not have a report-reading role.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The run does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'RUN_NOT_TERMINAL when the run is still RUNNING. The response contains a safe status detail.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Run id.',
  })
  getReport(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RunReportDto> {
    return this.reportsService.getRunReport(id);
  }

  @Get(':id/export')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary:
      'Download a terminal run report as a CSV or JSON attachment built from the same immutable projection.',
  })
  @ApiQuery({
    name: 'format',
    required: true,
    enum: Object.values(ReportExportFormat),
    description:
      'csv produces UTF-8 BOM, comma-delimited CRLF rows with RFC 4180 quoting; json produces the same schemaVersion=1 report projection.',
  })
  @ApiOkResponse({
    description:
      'Attachment response with Cache-Control: no-store. The filename is derived only from the canonical run UUID. CSV rows contain one line per actually recorded measurement, ordered by step position and sample index; JSON preserves decimal strings.',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary',
          description:
            'UTF-8 CSV document starting with a BOM. Header-only when the run has no recorded measurements.',
        },
      },
      'application/json': {
        schema: { $ref: getSchemaPath(RunReportDto) },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The run id is not a UUID, format is missing or not csv/json, or an unknown query parameter was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user does not have a report-reading role.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The run does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'RUN_NOT_TERMINAL when the run is still RUNNING. Terminal statuses are all exportable.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Run id.',
  })
  async exportRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ReportExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const report = await this.reportsService.getRunReport(id);
    const filename = attachmentFilename(report.runId, query.format);

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    if (query.format === ReportExportFormat.CSV) {
      response.setHeader('Content-Type', REPORT_CSV_CONTENT_TYPE);
      response.status(HttpStatus.OK).send(serialiseRunReportCsv(report));
      return;
    }

    response.setHeader('Content-Type', REPORT_JSON_CONTENT_TYPE);
    response.status(HttpStatus.OK).json(report);
  }
}

function attachmentFilename(runId: string, format: ReportExportFormat): string {
  if (!SAFE_RUN_ID.test(runId)) {
    // UUID database columns make this unreachable for stored runs. Failing
    // closed keeps user-controlled plan/device text out of response headers.
    throw new Error('The stored run id cannot be used in a download filename.');
  }

  return `probedesk-run-${runId}.${format}`;
}
