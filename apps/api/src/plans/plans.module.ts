import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlanCopyService } from './plan-copy.service.js';
import { PlanVersionsController } from './plan-versions.controller.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlansController, PlanVersionsController],
  providers: [PlansService, PlanCopyService],
})
export class PlansModule {}
