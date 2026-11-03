import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RunEventsController } from '../events/run-events.controller.js';
import {
  DEFAULT_RUN_EVENT_STREAM_OPTIONS,
  RUN_EVENT_STREAM_OPTIONS,
} from '../events/run-events.options.js';
import { RunEventsService } from '../events/run-events.service.js';
import { RunCancellationService } from './run-cancel.service.js';
import { RunExecutor } from './run-executor.js';
import { RunHistoryService } from './run-history.service.js';
import { RunRecoveryService } from './run-recovery.service.js';
import { RUN_SCHEDULER, RealRunScheduler } from './run-scheduler.js';
import { RunSnapshotService } from './run-snapshot.service.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

/**
 * Run start, asynchronous sequential execution, cancellation, startup recovery,
 * consistent snapshot reads and the durable SSE event stream.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController, RunEventsController],
  providers: [
    RunsService,
    RunCancellationService,
    RunHistoryService,
    RunSnapshotService,
    RunExecutor,
    RunRecoveryService,
    RunEventsService,
    {
      provide: RUN_EVENT_STREAM_OPTIONS,
      useValue: DEFAULT_RUN_EVENT_STREAM_OPTIONS,
    },
    { provide: RUN_SCHEDULER, useClass: RealRunScheduler },
  ],
  exports: [RunRecoveryService],
})
export class RunsModule {}
