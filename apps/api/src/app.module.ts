import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [AppConfigModule, PrismaModule, HealthModule],
})
export class AppModule {}
