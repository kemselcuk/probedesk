import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RunExecutor } from './run-executor.js';
import { RUN_SCHEDULER, RealRunScheduler } from './run-scheduler.js';
import { RunSnapshotService } from './run-snapshot.service.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

/**
 * Run start, the asynchronous sequential executor and the consistent snapshot
 * read endpoints. Cancellation, recovery and SSE are added by later Phase 3/4
 * tasks.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [
    RunsService,
    RunSnapshotService,
    RunExecutor,
    { provide: RUN_SCHEDULER, useClass: RealRunScheduler },
  ],
})
export class RunsModule {}
