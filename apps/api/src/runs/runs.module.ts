import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RunCancellationService } from './run-cancel.service.js';
import { RunExecutor } from './run-executor.js';
import { RunRecoveryService } from './run-recovery.service.js';
import { RUN_SCHEDULER, RealRunScheduler } from './run-scheduler.js';
import { RunSnapshotService } from './run-snapshot.service.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

/**
 * Run start, asynchronous sequential execution, cancellation, startup recovery
 * and the consistent snapshot read endpoints.
 */
@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [
    RunsService,
    RunCancellationService,
    RunSnapshotService,
    RunExecutor,
    RunRecoveryService,
    { provide: RUN_SCHEDULER, useClass: RealRunScheduler },
  ],
  exports: [RunRecoveryService],
})
export class RunsModule {}
