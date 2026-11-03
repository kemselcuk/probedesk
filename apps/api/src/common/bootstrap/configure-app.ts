import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from '../errors/api-exception.filter.js';
import { validationExceptionFactory } from '../errors/validation.exception.js';
import { requestIdMiddleware } from '../http/request-id.js';

/**
 * Applies the shared HTTP behaviour to every Nest application, including test
 * applications. Keeping it in one place means Supertest exercises exactly the
 * pipeline used by main.ts.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  app.use(requestIdMiddleware);
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      validationError: {
        target: false,
        value: false,
      },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new ApiExceptionFilter());
}
