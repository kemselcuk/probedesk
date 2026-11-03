import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeviceProfilesController } from './device-profiles.controller.js';
import { DeviceProfilesService } from './device-profiles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DeviceProfilesController],
  providers: [DeviceProfilesService],
  exports: [DeviceProfilesService],
})
export class DeviceProfilesModule {}
