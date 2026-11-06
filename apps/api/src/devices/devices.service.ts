import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { Prisma, type Device } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  normalizeDeviceDescription,
  normalizeDeviceName,
  normalizeDeviceSerialNumber,
  toDeviceSerialNumberKey,
} from './device-domain.js';
import { DeviceDto, DeviceListResponseDto } from './dto/device.dto.js';
import { CreateDeviceDto } from './dto/create-device.dto.js';
import {
  DEFAULT_DEVICE_LIMIT,
  DEFAULT_DEVICE_PAGE,
  type ListDevicesQueryDto,
} from './dto/list-devices-query.dto.js';
import { UpdateDeviceDto } from './dto/update-device.dto.js';

const LIST_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

/**
 * Mutations use READ COMMITTED so a waiting FOR UPDATE lock observes the
 * revision committed by the transaction that held the row first. REPEATABLE
 * READ would raise a serialization failure instead of the documented 409.
 */
const MUTATION_TRANSACTION_OPTIONS = {
  timeout: 10_000,
  maxWait: 5_000,
} as const;

interface DeviceListRow {
  id: string;
  deviceProfileId: string;
  name: string;
  serialNumber: string;
  description: string | null;
  archivedAt: Date | string | null;
  editRevision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface LockedDeviceRow {
  id: string;
}

/**
 * Device identity management. Mutations lock the device row with FOR UPDATE
 * before reading its revision, so updates, archive, restore and the later run
 * start (FOR SHARE) serialize on the same row.
 */
@Injectable()
export class DevicesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListDevicesQueryDto): Promise<DeviceListResponseDto> {
    const page = query.page ?? DEFAULT_DEVICE_PAGE;
    const limit = query.limit ?? DEFAULT_DEVICE_LIMIT;
    const where = buildWhere(query);

    return this.prisma.$transaction(async (tx) => {
      const countRows = await tx.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`SELECT count(*)::int AS total FROM "devices" AS d ${where}`,
      );
      const total = countRows[0]?.total ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      if (totalPages === 0 || page > totalPages) {
        return { items: [], page, limit, total, totalPages };
      }

      const rows = await tx.$queryRaw<DeviceListRow[]>(
        Prisma.sql`
          SELECT
            d."id",
            d."deviceProfileId",
            d."name",
            d."serialNumber",
            d."description",
            d."archivedAt",
            d."editRevision",
            d."createdAt",
            d."updatedAt"
          FROM "devices" AS d
          ${where}
          ORDER BY d."name" ASC, d."id" ASC
          LIMIT ${limit} OFFSET ${(page - 1) * limit}
        `,
      );

      return { items: rows.map(toListDto), page, limit, total, totalPages };
    }, LIST_TRANSACTION_OPTIONS);
  }

  async findById(id: string): Promise<DeviceDto> {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw notFound();
    }

    return toDeviceDto(device);
  }

  async create(plannerId: string, dto: CreateDeviceDto): Promise<DeviceDto> {
    const profile = await this.prisma.deviceProfile.findUnique({
      where: { id: dto.deviceProfileId },
      select: { id: true },
    });

    if (!profile) {
      throw new ValidationFailedException([
        {
          path: 'deviceProfileId',
          code: 'INVALID_VALUE',
          message:
            'deviceProfileId does not reference an existing device profile',
        },
      ]);
    }

    const name = normalizeDeviceName(dto.name);
    const serialNumber = normalizeDeviceSerialNumber(dto.serialNumber);

    try {
      const device = await this.prisma.device.create({
        data: {
          deviceProfileId: profile.id,
          createdById: plannerId,
          name,
          serialNumber,
          serialNumberKey: toDeviceSerialNumberKey(serialNumber),
          description: normalizeDeviceDescription(dto.description),
        },
      });

      return toDeviceDto(device);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw serialConflict();
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const device = await lockDevice(tx, id);
        assertRevision(device, dto.expectedRevision);

        const data: Prisma.DeviceUpdateManyMutationInput = {};
        let changed = false;

        if (dto.name !== undefined) {
          const name = normalizeDeviceName(dto.name);
          if (name !== device.name) {
            data.name = name;
            changed = true;
          }
        }

        if (dto.serialNumber !== undefined) {
          const serialNumber = normalizeDeviceSerialNumber(dto.serialNumber);
          if (serialNumber !== device.serialNumber) {
            data.serialNumber = serialNumber;
            data.serialNumberKey = toDeviceSerialNumberKey(serialNumber);
            changed = true;
          }
        }

        if (dto.description !== undefined) {
          const description = normalizeDeviceDescription(dto.description);
          if (description !== device.description) {
            data.description = description;
            changed = true;
          }
        }

        if (!changed) {
          return toDeviceDto(device);
        }

        data.editRevision = { increment: 1 };

        const updated = await tx.device.updateMany({
          where: { id, editRevision: dto.expectedRevision },
          data,
        });

        if (updated.count === 0) {
          throw deviceConflict(device.editRevision);
        }

        return toDeviceDto(
          await tx.device.findUniqueOrThrow({ where: { id } }),
        );
      }, MUTATION_TRANSACTION_OPTIONS);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw serialConflict();
      }
      throw error;
    }
  }

  archive(id: string, expectedRevision: number): Promise<DeviceDto> {
    return this.setArchivedState(id, expectedRevision, true);
  }

  restore(id: string, expectedRevision: number): Promise<DeviceDto> {
    return this.setArchivedState(id, expectedRevision, false);
  }

  private async setArchivedState(
    id: string,
    expectedRevision: number,
    archive: boolean,
  ): Promise<DeviceDto> {
    return this.prisma.$transaction(async (tx) => {
      const device = await lockDevice(tx, id);
      assertRevision(device, expectedRevision);

      const alreadyInTargetState = archive
        ? device.archivedAt !== null
        : device.archivedAt === null;

      if (alreadyInTargetState) {
        return toDeviceDto(device);
      }

      const updated = await tx.device.updateMany({
        where: { id, editRevision: expectedRevision },
        data: {
          archivedAt: archive ? new Date() : null,
          editRevision: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw deviceConflict(device.editRevision);
      }

      return toDeviceDto(await tx.device.findUniqueOrThrow({ where: { id } }));
    }, MUTATION_TRANSACTION_OPTIONS);
  }
}

function buildWhere(query: ListDevicesQueryDto): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  const state = query.state ?? 'active';

  if (state === 'active') {
    conditions.push(Prisma.sql`d."archivedAt" IS NULL`);
  } else if (state === 'archived') {
    conditions.push(Prisma.sql`d."archivedAt" IS NOT NULL`);
  }

  if (query.deviceProfileId !== undefined) {
    conditions.push(
      Prisma.sql`d."deviceProfileId" = ${query.deviceProfileId}::uuid`,
    );
  }

  const q = query.q?.trim();
  if (q !== undefined && q.length > 0) {
    // Escape LIKE metacharacters so `%`, `_` and `\` are searched literally.
    const prefix = `${q.replace(/[\\%_]/g, '\\$&')}%`;
    conditions.push(
      Prisma.sql`(d."name" ILIKE ${prefix} ESCAPE '\\' OR d."serialNumber" ILIKE ${prefix} ESCAPE '\\')`,
    );
  }

  if (conditions.length === 0) {
    return Prisma.empty;
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

async function lockDevice(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<Device> {
  const rows = await tx.$queryRaw<LockedDeviceRow[]>`
    SELECT "id" FROM "devices" WHERE "id" = ${id}::uuid FOR UPDATE
  `;

  if (rows.length === 0) {
    throw notFound();
  }

  return tx.device.findUniqueOrThrow({ where: { id } });
}

function assertRevision(device: Device, expectedRevision: number): void {
  if (device.editRevision !== expectedRevision) {
    throw deviceConflict(device.editRevision);
  }
}

function toDeviceDto(device: Device): DeviceDto {
  return {
    id: device.id,
    deviceProfileId: device.deviceProfileId,
    name: device.name,
    serialNumber: device.serialNumber,
    description: device.description,
    archivedAt: device.archivedAt?.toISOString() ?? null,
    editRevision: device.editRevision,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}

function toListDto(row: DeviceListRow): DeviceDto {
  return {
    id: row.id,
    deviceProfileId: row.deviceProfileId,
    name: row.name,
    serialNumber: row.serialNumber,
    description: row.description,
    archivedAt: toIso(row.archivedAt),
    editRevision: row.editRevision,
    createdAt: toRequiredIso(row.createdAt),
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toRequiredIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}

function notFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'The requested resource was not found.',
  );
}

function deviceConflict(currentRevision: number): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'DEVICE_CONFLICT',
    'The device was changed by another request. Reload it and try again.',
    { details: { currentRevision } },
  );
}

function serialConflict(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'DEVICE_SERIAL_CONFLICT',
    'A device with this serial number already exists in the profile.',
  );
}
