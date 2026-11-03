import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ValidationProbeDto } from './validation-probe.dto.js';

/**
 * Test-only controller used to exercise the global validation pipe and the
 * exception filter without adding a product route ahead of its task card.
 */
@Controller('test-validation')
export class ValidationProbeController {
  @Post()
  create(@Body() body: ValidationProbeDto): {
    received: ValidationProbeDto;
  } {
    return { received: body };
  }

  @Get('boom')
  boom(): never {
    throw new Error('SELECT secret FROM users; password=supersecret');
  }

  @Get('http-error')
  httpError(): never {
    throw new HttpException('token=supersecret', HttpStatus.BAD_REQUEST);
  }
}
