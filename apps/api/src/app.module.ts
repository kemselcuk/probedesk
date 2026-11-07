import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ComparisonsModule } from './comparisons/comparisons.module.js';
import { AppConfigModule } from './config/env.js';
import { DeviceProfilesModule } from './device-profiles/device-profiles.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthModule } from './health/health.module.js';
import { PlansModule } from './plans/plans.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RunsModule } from './runs/runs.module.js';
import { ReportsModule } from './reports/reports.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    DeviceProfilesModule,
    DevicesModule,
    PlansModule,
    RunsModule,
    ReportsModule,
    ComparisonsModule,
  ],
})
export class AppModule {}
