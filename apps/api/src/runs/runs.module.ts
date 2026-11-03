import { Module } from '@nestjs/common';

/**
 * Run orchestration module skeleton.
 *
 * P3-03 only adds the persistence model and pure snapshot/domain helpers.
 * P3-04 adds the start transaction and controllers, P3-05 the executor and
 * P3-07/P3-08 cancellation/recovery. Register this module in `AppModule` as
 * part of P3-04, when the first controller exists.
 */
@Module({})
export class RunsModule {}
