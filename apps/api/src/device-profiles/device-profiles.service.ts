import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceProfileDto } from './dto/device-profile.dto.js';

@Injectable()
export class DeviceProfilesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Lists the available profiles. The initial product has one seeded profile;
   * returning a list keeps the read shape stable if a later phase adds another.
   */
  async list(): Promise<DeviceProfileDto[]> {
    const profiles = await this.prisma.deviceProfile.findMany({
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });

    return profiles.map((profile) => ({
      id: profile.id,
      code: profile.code,
      name: profile.name,
      description: profile.description,
    }));
  }
}
