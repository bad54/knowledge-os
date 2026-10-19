import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from '@knowledge/shared';
import { PipelineError } from '@knowledge/domain';
import { logger } from '../infrastructure/logger';
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ZodError || error instanceof PipelineError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : 500;
    const message =
      error instanceof ZodError
        ? 'Entrée invalide : ' + error.issues.map((i) => i.path.join('.') || i.message).join(', ')
        : error instanceof PipelineError || error instanceof HttpException
          ? error.message
          : 'Erreur interne';
    if (status >= 500) logger.error({ event: 'api.failed', code: 'INTERNAL_ERROR' });
    response.status(status).json({ statusCode: status, message });
  }
}
