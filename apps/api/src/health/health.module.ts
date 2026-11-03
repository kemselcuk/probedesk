import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [RunsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
