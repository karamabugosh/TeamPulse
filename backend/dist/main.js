"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    console.log('SLACK_BOT_TOKEN set:', !!process.env.SLACK_BOT_TOKEN);
    console.log('SLACK_SIGNING_SECRET set:', !!process.env.SLACK_SIGNING_SECRET);
    console.log('SLACK_APP_TOKEN set:', !!process.env.SLACK_APP_TOKEN);
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors();
    const port = Number(process.env.PORT) || 3000;
    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map