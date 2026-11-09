import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express, NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from '../errors/api-exception.filter.js';
import { validationExceptionFactory } from '../errors/validation.exception.js';
import { requestIdMiddleware } from '../http/request-id.js';

export interface ConfigureAppOptions {
  /**
   * Trust exactly one proxy hop. Enabled only when the API is reached through
   * the delivery proxy, which overwrites X-Forwarded-For with the direct client
   * address. Without it, every client behind the proxy shares one throttle key.
   */
  trustProxy?: boolean;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;

/**
 * Applies the shared HTTP behaviour to every Nest application, including test
 * applications. Keeping it in one place means Supertest exercises exactly the
 * pipeline used by main.ts.
 */
export function configureApp(
  app: INestApplication,
  options: ConfigureAppOptions = {},
): void {
  // `getHttpAdapter()` is typed against the generic HTTP-server interface, so
  // the Express instance needs an explicit cast.
  const expressApp = app.getHttpAdapter().getInstance() as Express;

  // Express advertises the framework by default; the API should not.
  expressApp.disable('x-powered-by');

  if (options.trustProxy === true) {
    expressApp.set('trust proxy', 1);
  }

  app.setGlobalPrefix('api');

  // A Content-Security-Policy is deliberately left to the delivery proxy:
  // Swagger UI needs inline styles and scripts and must keep working.
  app.use((_request: Request, response: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    next();
  });

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
