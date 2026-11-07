import type { components } from '@probedesk/api-client';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';

type RunMetadata = Pick<
  components['schemas']['RunSnapshotDto'],
  'deviceId' | 'deviceSnapshot' | 'batchNumber'
>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Required nullable snapshot fields never fall back to live device values. */
export function parseRunMetadata(record: Record<string, unknown>, endpoint: string): RunMetadata {
  const fail = (): never => {
    throw new MalformedApiResponseError(endpoint, 'invalid stored device or batch metadata.');
  };
  const id = record['deviceId'];
  const snapshot = record['deviceSnapshot'];
  const batch = record['batchNumber'];
  if (
    batch !== null &&
    (typeof batch !== 'string' ||
      batch.length < 1 ||
      batch.length > 100 ||
      !/^[A-Za-z0-9._:/-]+$/.test(batch))
  )
    fail();
  if (id === null && snapshot === null)
    return { deviceId: null, deviceSnapshot: null, batchNumber: batch as string | null };
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    typeof snapshot !== 'object' ||
    snapshot === null ||
    Array.isArray(snapshot)
  )
    return fail();
  const device = snapshot as Record<string, unknown>;
  if (
    typeof device['id'] !== 'string' ||
    device['id'].toLowerCase() !== id.toLowerCase() ||
    typeof device['deviceProfileId'] !== 'string' ||
    !UUID.test(device['deviceProfileId']) ||
    typeof device['name'] !== 'string' ||
    device['name'].length < 1 ||
    device['name'].length > 100 ||
    typeof device['serialNumber'] !== 'string' ||
    !/^[A-Za-z0-9._:/-]{1,100}$/.test(device['serialNumber'])
  )
    return fail();
  return {
    deviceId: id,
    deviceSnapshot: {
      id: device['id'],
      name: device['name'],
      serialNumber: device['serialNumber'],
      deviceProfileId: device['deviceProfileId'],
    },
    batchNumber: batch as string | null,
  };
}
