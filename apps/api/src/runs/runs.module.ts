import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

/**
 * Run start for P3-04. The executor, snapshot reads, cancellation, recovery and
 * SSE endpoints are added by later Phase 3 tasks.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [RunsService],
})
export class RunsModule {}
