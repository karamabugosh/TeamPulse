import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
    // Test if .env variables are loaded
    console.log('BOT TOKEN:', process.env.SLACK_BOT_TOKEN);
    console.log('SIGNING SECRET:', process.env.SLACK_SIGNING_SECRET);
    console.log('APP TOKEN:', process.env.SLACK_APP_TOKEN);
    console.log('PORT:', process.env.PORT);

    const app = await NestFactory.create(AppModule);
    app.enableCors();

    const port = process.env.PORT || 3000;

    await app.listen(port);

    console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();