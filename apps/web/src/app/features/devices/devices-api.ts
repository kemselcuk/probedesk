import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { components, operations } from '@probedesk/api-client';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';

export type Device = components['schemas']['DeviceDto'];
export type DevicePage = components['schemas']['DeviceListResponseDto'];
export type CreateDevice = components['schemas']['CreateDeviceDto'];
export type UpdateDevice = components['schemas']['UpdateDeviceDto'];
export type DeviceQuery = NonNullable<operations['DevicesController_list']['parameters']['query']>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class DevicesApi {
  private readonly http = inject(HttpClient);

  list(query: DeviceQuery): Observable<DevicePage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<unknown>('/api/devices', { params }).pipe(
      map((value) => {
        const page = record(value);
        if (!Array.isArray(page['items'])) return invalid();
        const result = {
          items: page['items'].map(parseDevice),
          page: integer(page['page'], 1),
          limit: integer(page['limit'], 1),
          total: integer(page['total'], 0),
          totalPages: integer(page['totalPages'], 0),
        };
        if (
          result.limit > 100 ||
          result.items.length > result.limit ||
          result.totalPages !== Math.ceil(result.total / result.limit)
        )
          return invalid();
        return result;
      }),
    );
  }

  get(id: string): Observable<Device> {
    return this.http.get<unknown>(`/api/devices/${encodeURIComponent(id)}`).pipe(
      map((value) => {
        const device = parseDevice(value);
        if (device.id.toLowerCase() !== id.toLowerCase()) return invalid();
        return device;
      }),
    );
  }

  create(body: CreateDevice): Observable<Device> {
    return this.http.post<unknown>('/api/devices', body).pipe(map(parseDevice));
  }

  update(id: string, body: UpdateDevice): Observable<Device> {
    return this.mutate(
      id,
      this.http.patch<unknown>(`/api/devices/${encodeURIComponent(id)}`, body),
    );
  }

  setArchived(device: Device, archived: boolean): Observable<Device> {
    return this.mutate(
      device.id,
      this.http.post<unknown>(
        `/api/devices/${encodeURIComponent(device.id)}/${archived ? 'archive' : 'restore'}`,
        { expectedRevision: device.editRevision },
      ),
    );
  }

  private mutate(id: string, request: Observable<unknown>): Observable<Device> {
    return request.pipe(
      map((value) => {
        const result = parseDevice(value);
        if (result.id.toLowerCase() !== id.toLowerCase()) return invalid();
        return result;
      }),
    );
  }
}

function invalid(): never {
  throw new MalformedApiResponseError('Devices', 'invalid device response.');
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function text(value: unknown, max: number): string {
  return typeof value === 'string' &&
    Array.from(value).length > 0 &&
    Array.from(value).length <= max
    ? value
    : invalid();
}
function uuid(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : invalid();
}
function date(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : invalid();
}
function integer(value: unknown, min: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value
    : invalid();
}
function parseDevice(value: unknown): Device {
  const item = record(value);
  const serial = text(item['serialNumber'], 100);
  if (!/^[A-Za-z0-9._:/-]+$/.test(serial)) return invalid();
  return {
    id: uuid(item['id']),
    deviceProfileId: uuid(item['deviceProfileId']),
    name: text(item['name'], 100),
    serialNumber: serial,
    description: item['description'] === null ? null : text(item['description'], 500),
    archivedAt: item['archivedAt'] === null ? null : date(item['archivedAt']),
    editRevision: integer(item['editRevision'], 1),
    createdAt: date(item['createdAt']),
    updatedAt: date(item['updatedAt']),
  };
}
