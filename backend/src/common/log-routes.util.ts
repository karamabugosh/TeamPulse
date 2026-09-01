import { INestApplication, Logger, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { ModulesContainer } from '@nestjs/core';

const logger = new Logger('Routes');

const REQUEST_METHOD_LABEL: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

function joinPaths(...segments: Array<string | undefined>): string {
  const joined = segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/**
 * Prints every HTTP route registered on the Nest app (includes global prefix).
 */
export function logRegisteredHttpRoutes(
  app: INestApplication,
  globalPrefix = 'api',
): void {
  const modulesContainer = app.get(ModulesContainer);
  const metadataScanner = new MetadataScanner();
  const lines: string[] = [];

  modulesContainer.forEach(({ controllers }) => {
    controllers.forEach(({ instance, metatype }) => {
      if (!instance || !metatype) return;

      const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const controllerBase = joinPaths(globalPrefix, controllerPath);

      metadataScanner
        .getAllMethodNames(Object.getPrototypeOf(instance))
        .forEach((methodName) => {
          const handler = instance[methodName];
          const routePath = Reflect.getMetadata(PATH_METADATA, handler);
          const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler);
          if (routePath === undefined || requestMethod === undefined) return;

          const method =
            REQUEST_METHOD_LABEL[requestMethod as RequestMethod] ??
            String(requestMethod);
          const fullPath = joinPaths(controllerBase, routePath);
          lines.push(`${method} ${fullPath}`);
        });
    });
  });

  lines.sort().forEach((line) => logger.log(line));
}
