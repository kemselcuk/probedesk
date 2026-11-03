import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RunExecutor } from './run-executor.js';
import { RUN_SCHEDULER, RealRunScheduler } from './run-scheduler.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

/**
 * Run start plus the asynchronous sequential executor. Snapshot reads,
 * cancellation, recovery and SSE endpoints are added by later Phase 3 tasks.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [
    RunsService,
    RunExecutor,
    { provide: RUN_SCHEDULER, useClass: RealRunScheduler },
  ],
})
export class RunsModule {}
