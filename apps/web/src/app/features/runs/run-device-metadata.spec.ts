import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { RunDeviceMetadata } from './run-device-metadata';

describe('recorded device metadata shared by Live, Details, Compare and Reports', () => {
  it('labels legacy null values explicitly rather than guessing current device information', () => {
    const fixture = TestBed.createComponent(RunDeviceMetadata);
    fixture.componentRef.setInput('run', { deviceSnapshot: null, batchNumber: null });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No device recorded');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No batch recorded');
  });
  it('shows the recorded device name, serial and batch without looking up a current device', () => {
    const fixture = TestBed.createComponent(RunDeviceMetadata);
    fixture.componentRef.setInput('run', {
      deviceSnapshot: { name: 'Original bench', serialNumber: 'SERIAL-OLD' },
      batchNumber: 'LOT-1',
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Original bench');
    expect(text).toContain('SERIAL-OLD');
    expect(text).toContain('LOT-1');
  });
});
