import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * Read-only report projection and CSV/JSON export for terminal runs.
 *
 * Production registration in AppModule is owned by the lead. Tests compile
 * this module beside AppModule and never assume it is already registered.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
