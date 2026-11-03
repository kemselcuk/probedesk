import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { AppConfigModule } from './config/env.js';
import { DeviceProfilesModule } from './device-profiles/device-profiles.module.js';
import { HealthModule } from './health/health.module.js';
import { PlansModule } from './plans/plans.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    DeviceProfilesModule,
    PlansModule,
  ],
})
export class AppModule {}
