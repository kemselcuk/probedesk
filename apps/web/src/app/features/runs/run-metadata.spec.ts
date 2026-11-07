import { describe, expect, it } from 'vitest';
import { parseRunMetadata } from './run-metadata';

const id = '11111111-1111-4111-8111-111111111111';
const device = {
  id,
  name: 'Bench supply',
  serialNumber: 'PSU-1',
  deviceProfileId: '22222222-2222-4222-8222-222222222222',
};
const metadata = { deviceId: id, deviceSnapshot: device, batchNumber: 'Batch-1' };

describe('stored run metadata', () => {
  it('preserves the copied device and display batch', () => {
    expect(parseRunMetadata(metadata, 'test')).toEqual(metadata);
  });
  it('supports legacy SQL-null metadata and a device-less batch', () => {
    expect(
      parseRunMetadata({ deviceId: null, deviceSnapshot: null, batchNumber: null }, 'test'),
    ).toEqual({ deviceId: null, deviceSnapshot: null, batchNumber: null });
    expect(
      parseRunMetadata({ deviceId: null, deviceSnapshot: null, batchNumber: 'Lot-2' }, 'test')
        .batchNumber,
    ).toBe('Lot-2');
  });
  it.each([
    {},
    { ...metadata, deviceId: null },
    { ...metadata, deviceSnapshot: null },
    { ...metadata, deviceSnapshot: { ...device, id: device.deviceProfileId } },
    { ...metadata, batchNumber: undefined },
    { ...metadata, batchNumber: 'bad batch' },
    { ...metadata, deviceSnapshot: { ...device, deviceProfileId: 'invalid' } },
  ])('rejects missing or inconsistent metadata: %j', (value) => {
    expect(() => parseRunMetadata(value, 'test')).toThrow(
      'invalid stored device or batch metadata',
    );
  });
});
