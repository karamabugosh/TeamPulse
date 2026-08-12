import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Log only whether secrets are set, never their actual values
  console.log('SLACK_BOT_TOKEN set:', !!process.env.SLACK_BOT_TOKEN);
  console.log('SLACK_SIGNING_SECRET set:', !!process.env.SLACK_SIGNING_SECRET);
  console.log('SLACK_APP_TOKEN set:', !!process.env.SLACK_APP_TOKEN);
  const appToken = process.env.SLACK_APP_TOKEN ?? '';
  if (appToken && !appToken.startsWith('xapp-')) {
    console.warn(
      'SLACK_APP_TOKEN should be an App-Level Token starting with "xapp-".',
    );
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();