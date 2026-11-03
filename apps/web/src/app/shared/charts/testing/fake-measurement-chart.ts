import type { ActiveElement, Chart, ChartEvent } from 'chart.js';
import type {
  MeasurementChartConfig,
  MeasurementChartFactory,
  MeasurementChartHandle,
} from '../measurement-chart.types';

/** Test handle that records updates without touching a canvas or Chart.js. */
export class FakeMeasurementChartHandle implements MeasurementChartHandle {
  config: MeasurementChartConfig;
  readonly updateCalls: MeasurementChartConfig[] = [];
  resetZoomCalls = 0;
  resizeCalls = 0;
  destroyCalls = 0;

  constructor(config: MeasurementChartConfig) {
    this.config = config;
  }

  update(config: MeasurementChartConfig): void {
    this.config = config;
    this.updateCalls.push(config);
  }

  resetZoom(): void {
    this.resetZoomCalls += 1;
  }

  resize(): void {
    this.resizeCalls += 1;
  }

  destroy(): void {
    this.destroyCalls += 1;
  }

  /** Simulates Chart.js reporting a clicked data element. */
  clickPoint(index: number): void {
    const onClick = this.config.options?.onClick;
    onClick?.(createChartEvent(), [createActiveElement(index)], fakeChart());
  }
}

export class FakeMeasurementChartFactory implements MeasurementChartFactory {
  readonly created: FakeMeasurementChartHandle[] = [];

  create(_canvas: HTMLCanvasElement, config: MeasurementChartConfig): MeasurementChartHandle {
    const handle = new FakeMeasurementChartHandle(config);
    this.created.push(handle);
    return handle;
  }
}

function createChartEvent(): ChartEvent {
  return {
    type: 'click',
    native: new MouseEvent('click'),
    x: 1,
    y: 1,
  };
}

function createActiveElement(index: number): ActiveElement {
  return {
    index,
    datasetIndex: 0,
    element: { x: 1, y: 1 },
  } as unknown as ActiveElement;
}

function fakeChart(): Chart {
  return null as unknown as Chart;
}
