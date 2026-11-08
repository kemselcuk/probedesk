import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { RunSnapshot } from './runs-api.types';

@Component({
  selector: 'app-run-device-metadata',
  template: `<div class="metadata">
    <div>
      <span class="label">Recorded device</span
      ><span>{{
        run().deviceSnapshot
          ? run().deviceSnapshot!.name + ' · ' + run().deviceSnapshot!.serialNumber
          : 'No device recorded'
      }}</span>
    </div>
    <div>
      <span class="label">Batch number</span
      ><span>{{ run().batchNumber ?? 'No batch recorded' }}</span>
    </div>
  </div>`,
  styles: `
    .metadata {
      display: flex;
      flex-wrap: wrap;
      gap: var(--pd-space-3) var(--pd-space-5);
      margin: var(--pd-space-3) 0;
    }
    .metadata > div {
      display: grid;
      gap: var(--pd-space-1);
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      font-size: var(--pd-font-body-size);
      line-height: var(--pd-font-body-relaxed-line);
    }
    .label {
      color: var(--pd-text-secondary);
      font-size: var(--pd-font-meta-size);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RunDeviceMetadata {
  readonly run = input.required<Pick<RunSnapshot, 'deviceSnapshot' | 'batchNumber'>>();
}
